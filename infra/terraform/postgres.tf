# ---------------------------------------------------------------------------
# Neon Serverless Postgres
#
# Only created when var.postgres_provider == "neon". If you are using
# Supabase, provision the database manually and pass POSTGRES_URL as an
# env var to Vercel (or set it in terraform.tfvars as a direct override).
# ---------------------------------------------------------------------------

resource "neon_project" "main" {
  count = var.postgres_provider == "neon" ? 1 : 0

  name      = var.project_name
  region_id = var.neon_region
}

resource "neon_database" "app" {
  count = var.postgres_provider == "neon" ? 1 : 0

  project_id = neon_project.main[0].id
  branch_id  = neon_project.main[0].default_branch_id
  owner_name = "neondb_owner"
  name       = var.project_name
}

# The connection URI is composed from Neon project outputs.
locals {
  neon_postgres_url = var.postgres_provider == "neon" ? neon_project.main[0].database_uri : ""
  postgres_url      = var.postgres_provider == "neon" ? local.neon_postgres_url : "MANUAL_SETUP_REQUIRED"
}
