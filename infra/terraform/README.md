# Terraform IaC — Self-hosted Multitenant Deployment

Minimal Terraform module for deploying the Open Agents platform.

## Providers

| Provider | Source | Managed by Terraform? |
|----------|--------|-----------------------|
| Vercel | `vercel/vercel` | Yes |
| Neon Postgres | `kislerdm/neon` | Yes (when `postgres_provider = "neon"`) |
| Supabase Postgres | — | Manual provisioning |
| Upstash Redis | — | Manual provisioning (no official provider) |

## Prerequisites

1. [Terraform >= 1.5](https://developer.hashicorp.com/terraform/install)
2. A Vercel account + API token
3. A Neon account + API key (set `NEON_API_KEY` env var) — or a Supabase project
4. An Upstash Redis database (manually provisioned)

## Quick start

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

export NEON_API_KEY="your-neon-api-key"

terraform init
terraform plan
terraform apply
```

## Variables

See `variables.tf` for the full list. Key inputs:

- `project_name` — Vercel + Neon project name
- `vercel_api_token` — Vercel API token (sensitive)
- `postgres_provider` — `"neon"` or `"supabase"`
- `domain` — optional custom domain
- `redis_url` — Upstash Redis REST URL (manually provisioned)
- `admin_user_ids` — comma-separated platform admin user IDs

## Outputs

- `POSTGRES_URL` — connection string (sensitive)
- `REDIS_URL` — Redis URL (sensitive)
- `VERCEL_PROJECT_URL` — production URL

## Notes

This is a **scaffold** for self-hosted deployments. The Vercel and Neon resources are functional; Upstash Redis and Supabase require manual setup. Review and adapt before production use.
