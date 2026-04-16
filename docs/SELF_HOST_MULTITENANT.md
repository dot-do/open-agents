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

### Verifying migrations

`scripts/verify-migrations.ts` applies every committed Drizzle migration
(currently 35, including the tenancy backfill `0030`, RLS policies `0034`,
and SSO configs `0035`) to a *fresh* database and then runs the drift
check. CI runs this on every PR against a `postgres:16` service
container; the `migrate-verify` job in `.github/workflows/ci.yml` is the
canonical invocation.

To run it locally, point `POSTGRES_URL` at an empty database and invoke
the root script:

```sh
# Example: start a throwaway Postgres in Docker
docker run --rm -d --name oa-verify \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=verify -p 5432:5432 postgres:16

POSTGRES_URL=postgres://postgres:postgres@localhost:5432/verify \
  bun run verify:migrations

docker rm -f oa-verify
```

The script refuses to run if `public.*` already contains user tables, so
it will not stomp on an existing dev database. After migrating it
sanity-checks that `tenants` and `memberships` exist with zero rows and
that at least 35 migrations are recorded in `drizzle.__drizzle_migrations`.

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

## 9. SSO (optional, enterprise plan)

Single sign-on is scaffolded but not wired — the app ships provider-agnostic
stubs so an enterprise customer can drop in WorkOS, Clerk, or a generic SAML
broker without touching the rest of the auth surface.

What's in the repo today:

- `tenant_sso_configs` table (migration `0035_tenant_sso.sql`) storing one
  row per tenant: provider, connection id, email domain, enabled flag.
- `apps/web/lib/sso/index.ts` — `SsoAdapter` interface, `getSsoAdapter()`
  returning stub adapters that throw `SsoNotConfigured`, and
  `lookupSsoForDomain(email)` for future login routes.
- `Settings → SSO` page gated behind `assertPlanAllows(ctx, 'sso')` — only
  visible/usable on the enterprise plan. Saves the config row but does
  not run any handshake.
- `GET/PUT /api/tenant/sso` — admin-only config CRUD.

To wire a real provider on your fork:

1. Install the SDK (`bun add workos` or `bun add @clerk/backend`, …).
2. Replace the corresponding entry in `STUB_ADAPTERS` with a real adapter
   that implements `initiate()` + `complete()`.
3. Set the env vars the stub advertises in its `SsoNotConfigured` error:
   - WorkOS: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`
   - Clerk: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
   - Generic SAML: `SAML_IDP_METADATA_URL`, `SAML_SP_ENTITY_ID`
4. Add a login route that calls `lookupSsoForDomain(email)` and delegates
   to `getSsoAdapter(provider).initiate(domain, returnTo)` before falling
   back to the default GitHub / Vercel OAuth flows.

The intent is to keep SSO additive — existing OAuth flows remain the
default for non-enterprise tenants.

## 10. Testing isolation

`apps/web/tests/multitenant-isolation.test.ts` is an end-to-end smoke test
that creates two tenants with overlapping fixture data (sessions, chats,
api keys, github installations, audit events) and asserts that tenant A
cannot read, update, or delete tenant B's rows through either:

- the app-level `scopedQuery` helper in `apps/web/lib/db/tenant-guard.ts`, or
- a transaction primed with `setTenantContext(tx, id)` from
  `apps/web/lib/db/rls.ts` (Postgres RLS policies in `0034_tenant_rls.sql`).

The test self-skips when `POSTGRES_URL` is unset so CI environments
without a database still pass. To run locally against a throwaway
database:

```sh
# 1. Point at a local/test Postgres and apply migrations.
export POSTGRES_URL="postgres://user:pass@localhost:5432/open_agents_test"
bun run --cwd apps/web db:migrate:apply

# 2. Run the isolated test suite (or just this file).
bun run test:isolated
# or
bun test apps/web/tests/multitenant-isolation.test.ts
```

The test cleans up everything it inserts in `afterAll`. A failure here
indicates either a regression in `scopedQuery` or that the RLS policy
for the affected table is missing / misconfigured.

