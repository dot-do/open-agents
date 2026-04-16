# Self-hosting open-agents (multitenant)

This guide covers deploying the dot-do fork of `vercel-labs/open-agents` as a
multitenant service. Every tenant is a row in Postgres with its own quota
envelope; sandbox and workflow isolation is handled by the existing runtime.

If you only need a single-tenant install, the upstream README is still the
fastest path — the steps below are a superset.

## 1. Fork and clone

```sh
gh repo fork dot-do/open-agents --clone
cd open-agents
bun install
```

Add the upstream remote so you can pull reference-app changes. See
[UPSTREAM_SYNC.md](./UPSTREAM_SYNC.md) for cadence and conflict hotspots.

```sh
git remote add upstream https://github.com/vercel-labs/open-agents.git
git fetch upstream
```

## 2. Environment

Copy `.env.example` (at the repo root or `apps/web/.env.example` — they share
names) and fill the required values.

Required for any deploy:

- `POSTGRES_URL` — Neon, Supabase, or any Postgres 15+.
- `JWE_SECRET` — random 32+ byte string.
- `ENCRYPTION_KEY` — 32-byte hex (64 chars). Rotates provider tokens.
- `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET` — Vercel
  OAuth for sign-in.
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `NEXT_PUBLIC_GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `NEXT_PUBLIC_GITHUB_APP_SLUG`,
  `GITHUB_WEBHOOK_SECRET` — GitHub App.

Recommended:

- `NEXT_PUBLIC_APP_URL` — public origin. Makes OG images and absolute URLs
  match your domain without relying on Vercel auto-URLs.
- `REDIS_URL` or `KV_URL` — shared cache across workers.
- `ELEVENLABS_API_KEY` — voice transcription.

Multitenant-only (fork additions):

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — reserved for the billing
  wave; safe to leave blank while running the free tier.
- `DEFAULT_TENANT_QUOTA_MAX_SESSIONS`
- `DEFAULT_TENANT_QUOTA_MAX_CONCURRENT_SANDBOXES`
- `DEFAULT_TENANT_QUOTA_MAX_SANDBOX_MINUTES_PER_DAY`
- `DEFAULT_TENANT_QUOTA_MAX_TOKENS_PER_DAY`
- `DEFAULT_TENANT_QUOTA_MAX_REPO_CLONE_MB`

The quota knobs only apply when a tenant row has no per-tenant override; they
set the floor for a new tenant at signup.

## 3. Provision Postgres

Any Postgres 15+ works. Neon is the upstream default.

```sh
createdb open_agents           # or use your provider's console
export POSTGRES_URL=postgres://...
```

## 4. Run migrations

```sh
bun install
bun run --cwd apps/web db:migrate
bun run --cwd apps/web db:check   # verifies generated SQL matches schema
```

`bun run build` (used on Vercel) also runs `db:migrate:apply` as a prebuild
step, so deploys self-heal. For local dev, run migrations explicitly.

## 5. First tenant

With multitenant enabled, a tenant is created on first sign-in. The first
user becomes the owner. To seed an admin tenant ahead of time, insert
directly:

```sql
INSERT INTO tenants (slug, name) VALUES ('acme', 'Acme Inc.');
```

Subsequent users joining under `acme` share its quota pool.

## 6. GitHub App install

1. Create a GitHub App (Settings → Developer settings → GitHub Apps → New).
2. Homepage URL: `https://YOUR_DOMAIN`.
3. Callback URL: `https://YOUR_DOMAIN/api/github/app/callback`.
4. Setup URL: same as callback. Enable "Redirect on update".
5. Check **Request user authorization (OAuth) during installation**.
6. Webhook URL: `https://YOUR_DOMAIN/api/github/app/webhook`. Secret goes in
   `GITHUB_WEBHOOK_SECRET`.
7. Permissions: Contents R/W, Pull requests R/W, Metadata R, Webhooks R.
8. Subscribe to events: Installation, Installation repositories, Push.
9. Generate a private key; store it in `GITHUB_APP_PRIVATE_KEY` (PEM with
   `\n` escapes, or base64-encoded PEM).
10. Install the app on a test repo and run a session end-to-end.

## 7. Sandbox quotas tuning

Sandbox concurrency and lifetime are bounded per-tenant. Tune the
`DEFAULT_TENANT_QUOTA_*` knobs for a safe baseline; override per-tenant in
the `tenants` table for paid plans.

Recommended starting values for a small deploy:

- `DEFAULT_TENANT_QUOTA_MAX_SESSIONS=25`
- `DEFAULT_TENANT_QUOTA_MAX_CONCURRENT_SANDBOXES=2`
- `DEFAULT_TENANT_QUOTA_MAX_SANDBOX_MINUTES_PER_DAY=120`
- `DEFAULT_TENANT_QUOTA_MAX_TOKENS_PER_DAY=2000000`
- `DEFAULT_TENANT_QUOTA_MAX_REPO_CLONE_MB=500`

Watch the `sandbox_sessions` and `tenant_usage` tables for saturation before
raising them.

## 8. Deploy

Vercel is the happy path (the project is workflow-SDK native). Any host that
supports Next 16 and long-running workflows will work if you bring your own
sandbox orchestrator. See `apps/web/SANDBOX-LIFECYCLE.md` for the sandbox
contract.
