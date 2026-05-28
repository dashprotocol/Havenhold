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
