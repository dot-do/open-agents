output "POSTGRES_URL" {
  description = "Postgres connection string (Neon or manual)"
  value       = local.postgres_url
  sensitive   = true
}

output "REDIS_URL" {
  description = "Redis URL (Upstash, manually provisioned)"
  value       = local.redis_url
  sensitive   = true
}

output "VERCEL_PROJECT_URL" {
  description = "Vercel project production URL"
  value       = "https://${vercel_project.app.name}.vercel.app"
}
