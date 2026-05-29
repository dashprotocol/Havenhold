output "bucket_name" {
  description = "S3 bucket name — use as AWS_S3_BUCKET in the server environment"
  value       = aws_s3_bucket.documents.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.documents.arn
}

output "iam_user_arn" {
  description = "ARN of the havenhold-api IAM user"
  value       = aws_iam_user.api.arn
}

output "github_actions_role_arn" {
  description = "ARN of the havenhold-github-actions IAM role (assumed via OIDC by GitHub Actions deploy job)"
  value       = aws_iam_role.github_actions.arn
}
