variable "project_name" {
  description = "Name of the Vercel project and Neon project"
  type        = string
  default     = "open-agents"
}

variable "vercel_api_token" {
  description = "Vercel API token for project management"
  type        = string
  sensitive   = true
}

variable "postgres_provider" {
  description = "Postgres provider to use: 'neon' (managed via Terraform) or 'supabase' (manual setup)"
  type        = string
  default     = "neon"

  validation {
    condition     = contains(["neon", "supabase"], var.postgres_provider)
    error_message = "postgres_provider must be 'neon' or 'supabase'."
  }
}

variable "domain" {
  description = "Custom domain to attach to the Vercel project (e.g. agents.example.com)"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format for Vercel git integration"
  type        = string
  default     = ""
}

variable "github_app_id" {
  description = "GitHub App ID for the platform's GitHub integration"
  type        = string
  default     = ""
}

variable "github_app_private_key" {
  description = "GitHub App private key (PEM-encoded)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_secret_key" {
  description = "Stripe secret key for billing"
  type        = string
  sensitive   = true
  default     = ""
}

variable "admin_user_ids" {
  description = "Comma-separated list of user IDs granted cross-tenant admin access"
  type        = string
  default     = ""
}

variable "redis_url" {
  description = "Upstash Redis URL (manually provisioned — see README)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "neon_region" {
  description = "Neon project region"
  type        = string
  default     = "aws-us-east-1"
}
