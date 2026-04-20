terraform {
  required_version = ">= 1.5"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 1.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.6"
    }
    # Upstash does not have an official Terraform provider.
    # Redis is provisioned manually — see README.md.
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
}

provider "neon" {
  # Requires NEON_API_KEY env var or explicit `api_key` argument.
  # See https://registry.terraform.io/providers/kislerdm/neon
}
