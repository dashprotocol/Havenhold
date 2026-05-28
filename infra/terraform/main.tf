terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local backend until D2, when the S3 bucket exists.
  # Migration sequence at D2:
  #   1. Add backend "s3" {} block (bucket, key, region).
  #   2. Run: terraform init -migrate-state
  # Skipping step 2 creates a second independent state file and causes drift.
  backend "local" {}
}

variable "env" {
  description = "Deployment environment (e.g. prod, staging)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
