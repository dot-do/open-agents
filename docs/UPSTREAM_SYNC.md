# Upstream sync

This fork tracks [`vercel-labs/open-agents`](https://github.com/vercel-labs/open-agents).
The upstream is active; we pull from it roughly weekly to stay close to the
reference app.

## Legacy route note — `/[username]` → `/t/[tenantSlug]`

Upstream's user-centric `/[username]/...` routes live on unchanged and are
considered **legacy**. The multitenant successor is `/t/[tenantSlug]/...`
(prefixed under `/t/` to avoid a Next.js dynamic-segment collision with
upstream's `/[username]` at the app root). Both coexist today; deprecation
of `/[username]` happens in a later PR once all tenant-aware pages are
migrated. Do not delete `/[username]` during upstream syncs.

### Redirect layer

`apps/web/app/[username]/layout.tsx` (fork-only) now 308-redirects legacy
hits to `/t/[tenantSlug]/...` by resolving the user's oldest-membership
tenant via `apps/web/lib/username-to-tenant.ts`. The underlying
`[username]` pages stay on disk so upstream merges remain low-friction —
the redirect simply fires before any of their business logic runs.

To disable the redirect (e.g. when debugging an upstream regression in a
`/[username]` page), set `DISABLE_LEGACY_USERNAME_ROUTES=false` in the
relevant `.env`. With the flag off, requests pass through to the original
upstream page unchanged. The flag defaults to `true`.

## One-time setup

```sh
git remote add upstream https://github.com/vercel-labs/open-agents.git
git fetch upstream
```

Confirm with `git remote -v`. Your `origin` points at the dot-do fork;
`upstream` is read-only as far as we're concerned.

## Weekly sync

Cadence: every Monday, or before starting a new fork-only feature.

```sh
git checkout main
git pull --ff-only origin main
git fetch upstream
git merge upstream/main
```

**Use merge, not rebase.** Our tenancy commits land on `main` and get pushed
to `origin` — rebasing rewrites their hashes and breaks any downstream
branches (CI, preview deploys, agent branches) that pointed at them. A merge
commit per sync is cheap and keeps history honest.

If the merge is clean:

```sh
bun install
bun run --cwd apps/web db:check
bun run typecheck
bun run test:isolated
git push origin main
```

If upstream added migrations, also run:

```sh
bun run --cwd apps/web db:migrate       # generate if schema changed
bun run --cwd apps/web db:migrate:apply # apply against local Postgres
```

## Conflict hotspots

In order of historical pain:

1. **`apps/web/lib/db/schema.ts`** — we add tenant scoping columns and the
   `tenants` / `tenant_usage` / `tenant_quotas` tables. Upstream regularly
   reshapes `sessions`, `chats`, `messages`. Resolve by keeping upstream's
   column changes *and* our `tenantId` FK + indexes. Never drop our tables.
2. **Session code** (`apps/web/lib/session/**`, `apps/web/app/api/auth/**`)
   — we inject tenant resolution into the session cookie. On conflict, keep
   upstream's auth flow and re-apply the tenant-lookup shim at the end.
3. **GitHub App integration** (`apps/web/lib/github/**`,
   `apps/web/app/api/github/**`) — upstream is adding webhook handlers.
   We extend webhook dispatch to fan out per-tenant. Merge upstream logic
   first, then re-wrap with our dispatcher.

When any of these conflict, pause the merge, resolve file-by-file, run
`bun run typecheck && bun run test:isolated`, then commit the merge.

## After a sync

Always run migrations against at least one tenant-populated database before
pushing — a schema change that's valid on an empty DB can still break
existing tenant rows.

```sh
bun run --cwd apps/web db:check
bun run --cwd apps/web db:migrate:apply
```

CI (`.github/workflows/ci.yml`) runs `db:check` on every push, which catches
generated-SQL drift but not runtime migration errors. Spot-check a staging
deploy before tagging a release.

## Escape hatch

If upstream makes a breaking change we can't absorb (e.g. removing
multi-session support), freeze `upstream` at the last good SHA:

```sh
git tag upstream-freeze-YYYY-MM-DD upstream/main
```

Document the reason in this file under a "Frozen upstream" heading and
cherry-pick individual fixes until we're ready to resume the sync.
