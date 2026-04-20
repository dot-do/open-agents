# ---------------------------------------------------------------------------
# Upstash Redis — manual provisioning
#
# Upstash does not have an official Terraform provider. Provision a Redis
# database at https://console.upstash.com and paste the REST URL + token
# into var.redis_url (or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
# directly in the Vercel project dashboard).
#
# Once provisioned, set redis_url in terraform.tfvars:
#
#   redis_url = "https://<region>.upstash.io"
#
# The value is forwarded to Vercel env vars via vercel.tf.
# ---------------------------------------------------------------------------

locals {
  redis_url = var.redis_url != "" ? var.redis_url : "MANUAL_SETUP_REQUIRED"
}
