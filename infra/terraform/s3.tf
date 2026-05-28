locals {
  bucket_name = "havenhold-${var.env}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "documents" {
  bucket = local.bucket_name

  # force_destroy allows terraform destroy on a non-empty bucket.
  # Keep false in normal operation — set to true only immediately before a
  # deliberate destroy, then apply before destroying.
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      # AWS-managed key (aws/s3). No key policy configuration required.
      # Upgrade to a customer-managed key (CMK) if key-level audit granularity
      # or explicit disable/rotation control becomes necessary.
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id

  # block_public_policy must be applied before a bucket policy can be set.
  depends_on = [aws_s3_bucket_public_access_block.documents]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonHTTPS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
