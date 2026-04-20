# ---------------------------------------------------------------------------
# Vercel project + environment variables + optional custom domain
# ---------------------------------------------------------------------------

resource "vercel_project" "app" {
  name      = var.project_name
  framework = "nextjs"

  git_repository = var.github_repo != "" ? {
    type = "github"
    repo = var.github_repo
  } : null
}

# ---- Environment variables forwarded from Terraform-managed resources ----

resource "vercel_project_environment_variable" "postgres_url" {
  project_id = vercel_project.app.id
  key        = "POSTGRES_URL"
  value      = local.postgres_url
  target     = ["production", "preview"]
}

resource "vercel_project_environment_variable" "redis_url" {
  project_id = vercel_project.app.id
  key        = "REDIS_URL"
  value      = local.redis_url
  target     = ["production", "preview"]
}

resource "vercel_project_environment_variable" "github_app_id" {
  count      = var.github_app_id != "" ? 1 : 0
  project_id = vercel_project.app.id
  key        = "GITHUB_APP_ID"
  value      = var.github_app_id
  target     = ["production", "preview"]
}

resource "vercel_project_environment_variable" "github_app_private_key" {
  count      = var.github_app_private_key != "" ? 1 : 0
  project_id = vercel_project.app.id
  key        = "GITHUB_APP_PRIVATE_KEY"
  value      = var.github_app_private_key
  target     = ["production", "preview"]
}

resource "vercel_project_environment_variable" "stripe_secret_key" {
  count      = var.stripe_secret_key != "" ? 1 : 0
  project_id = vercel_project.app.id
  key        = "STRIPE_SECRET_KEY"
  value      = var.stripe_secret_key
  target     = ["production"]
}

resource "vercel_project_environment_variable" "admin_user_ids" {
  count      = var.admin_user_ids != "" ? 1 : 0
  project_id = vercel_project.app.id
  key        = "ADMIN_USER_IDS"
  value      = var.admin_user_ids
  target     = ["production", "preview"]
}

# ---- Custom domain (optional) ----

resource "vercel_project_domain" "custom" {
  count      = var.domain != "" ? 1 : 0
  project_id = vercel_project.app.id
  domain     = var.domain
}
