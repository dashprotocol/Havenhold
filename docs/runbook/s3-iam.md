# Runbook: S3 Storage + IAM Setup

## Purpose
Provision the Havenhold S3 bucket and IAM credentials for document storage using the Terraform module in `infra/terraform/`. This runbook covers two phases:

- **D0 phase (H-008):** Terraform module written and reviewed; `terraform plan` verified. No AWS resources created yet.
- **D2 phase (H-016/H-017):** `terraform apply` executed, access key generated, credentials injected into the host environment. Run immediately before deploying the upload flow.

## Security Handling
- This runbook is git-tracked and must stay sanitised — never commit real AWS credentials, account IDs, or key IDs.
- AWS access keys are generated once at D2 and injected into the host via the systemd `EnvironmentFile` or `/opt/havenhold/server/.env`. They must never be committed to the repo.
- Store generated access keys in approved secret storage (e.g. 1Password) immediately after creation — the secret value cannot be retrieved again from AWS.
- Rotate access keys if any exposure is suspected; see [Access Key Rotation](#access-key-rotation) below.

## Prerequisites
- AWS account with IAM `AdministratorAccess` (or equivalent) for the operator running Terraform.
- Terraform v1.x installed locally (`terraform -version`).
- AWS CLI v2 installed and configured (`aws --version`, `aws sts get-caller-identity`).
- `var.env` value decided (`prod` by default).

---

## D0 Steps: Verify Scaffolding

No AWS resources are created at D0. Verify the module plans cleanly:

```bash
cd infra/terraform

# Download provider
terraform init

# Plan against your AWS account — review output, expect no errors
AWS_REGION=us-east-1 terraform plan -var="env=prod"
```

Expected plan output: 7 resources to add (bucket, public access block, ownership controls, encryption config, bucket policy, IAM user, IAM user policy). No destroy or modify actions.

---

## D2 Steps: Apply and Configure

Run these steps immediately before deploying the upload flow (`H-016`/`H-017`).

### Step 1: Apply Terraform

```bash
cd infra/terraform
terraform init   # if not already done
terraform plan -var="env=prod"   # review before applying
terraform apply -var="env=prod"
```

Capture the outputs:

```bash
terraform output
# bucket_name = "havenhold-prod-<account-id>"
# bucket_arn  = "arn:aws:s3:::havenhold-prod-<account-id>"
# iam_user_arn = "arn:aws:iam::<account-id>:user/havenhold-api"
```

### Step 2: Generate access key

```bash
aws iam create-access-key --user-name havenhold-api
```

The response contains `AccessKeyId` and `SecretAccessKey`. **Save both values to your secret store immediately** — the secret cannot be retrieved again.

### Step 3: Inject credentials into host environment

SSH to the app host and add the variables to the server env file:

```bash
KEY_PATH=/path/to/key.pem
STATIC_IP=<lightsail-static-ip>
ADMIN_USER=adminuser

ssh -i "$KEY_PATH" "$ADMIN_USER"@"$STATIC_IP"
sudo nano /opt/havenhold/server/.env
```

Add or update these lines (values from Steps 1 and 2):

```dotenv
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<AccessKeyId from Step 2>
AWS_SECRET_ACCESS_KEY=<SecretAccessKey from Step 2>
AWS_S3_BUCKET=<bucket_name from terraform output>
```

Restart the app process so it picks up the new variables:

```bash
# Confirm the correct unit name before restarting — the API service unit is
# defined as part of the host deploy process, not a specific ticket.
sudo systemctl list-units --type=service | grep havenhold
sudo systemctl restart <havenhold-api-unit-name>
```

---

## D2 Verification Checklist

```bash
export BUCKET=<bucket_name from terraform output>

# 1. Public access block (all four must be true)
aws s3api get-public-access-block --bucket "$BUCKET"

# 2. Encryption (SSEAlgorithm must be aws:kms)
aws s3api get-bucket-encryption --bucket "$BUCKET"

# 3. Bucket policy (DenyNonHTTPS statement present)
aws s3api get-bucket-policy --bucket "$BUCKET" | python3 -m json.tool

# 4. IAM policy attached and scoped correctly
aws iam get-user-policy --user-name havenhold-api --policy-name HavenholdS3Access \
  | python3 -m json.tool

# 5. Active access key exists
aws iam list-access-keys --user-name havenhold-api

# 6. Positive test — put/get/delete under uploads/ (run with API credentials)
export API_KEY=<AccessKeyId>
export API_SECRET=<SecretAccessKey>

echo "d2-smoke" | AWS_ACCESS_KEY_ID=$API_KEY AWS_SECRET_ACCESS_KEY=$API_SECRET \
  aws s3 cp - s3://$BUCKET/uploads/d2-smoke.txt
AWS_ACCESS_KEY_ID=$API_KEY AWS_SECRET_ACCESS_KEY=$API_SECRET \
  aws s3api head-object --bucket "$BUCKET" --key uploads/d2-smoke.txt
AWS_ACCESS_KEY_ID=$API_KEY AWS_SECRET_ACCESS_KEY=$API_SECRET \
  aws s3 rm s3://$BUCKET/uploads/d2-smoke.txt

# 7. Negative test — account discovery (expect AccessDenied)
AWS_ACCESS_KEY_ID=$API_KEY AWS_SECRET_ACCESS_KEY=$API_SECRET \
  aws s3api list-buckets

# 8. Negative test — out-of-prefix write (expect AccessDenied)
echo "should-fail" | AWS_ACCESS_KEY_ID=$API_KEY AWS_SECRET_ACCESS_KEY=$API_SECRET \
  aws s3 cp - s3://$BUCKET/misc/should-fail.txt
```

---

## Access Key Rotation

Rotate the access key without any downtime:

```bash
# 1. Create a new key
aws iam create-access-key --user-name havenhold-api
# Save new AccessKeyId and SecretAccessKey to secret store

# 2. Update /opt/havenhold/server/.env on the host with the new values
# 3. Restart the app (confirm unit name: systemctl list-units --type=service | grep havenhold)
sudo systemctl restart <havenhold-api-unit-name>

# 4. Verify the app is healthy, then delete the old key
aws iam delete-access-key --user-name havenhold-api --access-key-id <OLD_KEY_ID>

# 5. Confirm only one active key remains
aws iam list-access-keys --user-name havenhold-api
```

---

## Rollback / Teardown

> **Warning:** `terraform destroy` fails on a non-empty bucket. There are two safe paths.

**Path A — bucket is empty (or at D2 before any uploads):**

```bash
cd infra/terraform
terraform destroy -var="env=prod"
```

**Path B — bucket contains objects:**

```bash
# Step 1: Confirm you intend to delete all objects
aws s3 ls s3://$BUCKET --recursive   # review what will be lost

# Step 2: Empty the bucket
aws s3 rm s3://$BUCKET --recursive

# Step 3: Destroy
cd infra/terraform
terraform destroy -var="env=prod"
```

Alternatively, set `force_destroy = true` in `s3.tf`, run `terraform apply`, then `terraform destroy`. Either way, confirm data disposition before proceeding — object deletion is permanent.

---

## State Backend Migration (D2)

After `terraform apply` succeeds and the bucket exists, migrate Terraform state into the bucket:

1. Add a backend block to `infra/terraform/main.tf`, replacing `backend "local" {}`:

```hcl
backend "s3" {
  bucket = "havenhold-prod-<account-id>"
  key    = "terraform/havenhold.tfstate"
  region = "us-east-1"
}
```

2. Migrate local state:

```bash
cd infra/terraform
terraform init -migrate-state
```

3. Confirm local `terraform.tfstate` is now empty/stale and the S3 object exists:

```bash
aws s3 ls s3://havenhold-prod-<account-id>/terraform/
```

4. Delete the local state file (it is now in S3):

```bash
rm terraform.tfstate
```

---

## Notes

- **CMK upgrade path:** If key-level CloudTrail granularity, explicit key disablement, or custom rotation schedules become necessary, create a KMS CMK, update `sse_algorithm` to reference its ARN, and add `kms:GenerateDataKey` + `kms:Decrypt` to the IAM policy scoped to that key ARN.
- **Signed URLs:** Direct public S3 URLs are always blocked. All file access goes through server-generated presigned URLs, implemented in `H-017`.
- **Versioning:** Not enabled. Revisit if point-in-time object recovery becomes a requirement.
