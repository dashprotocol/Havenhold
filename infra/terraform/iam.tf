# ── GitHub Actions OIDC (no static credentials) ───────────────────────────────
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "havenhold-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:dashprotocol/Havenhold:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions_ssm" {
  name = "HavenholdSSMReadOnly"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "SSMReadProd"
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ]
      # If switching to a customer-managed KMS key for SecureString parameters,
      # add kms:Decrypt on the key ARN here.
      Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/havenhold/prod/*"
    }]
  })
}

# ── App server S3 access ───────────────────────────────────────────────────────
resource "aws_iam_user" "api" {
  name = "havenhold-api"
  path = "/"
}

resource "aws_iam_user_policy" "api_s3" {
  name = "HavenholdS3Access"
  user = aws_iam_user.api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.documents.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["uploads/*", "exports/*", "temp/*"]
          }
        }
      },
      {
        Sid    = "ObjectReadWrite"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload"
        ]
        # Explicitly scoped to approved prefixes — not a wildcard on the whole bucket.
        Resource = [
          "${aws_s3_bucket.documents.arn}/uploads/*",
          "${aws_s3_bucket.documents.arn}/exports/*",
          "${aws_s3_bucket.documents.arn}/temp/*"
        ]
      }
    ]
  })
}
