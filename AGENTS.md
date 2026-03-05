# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)

## Database & Migrations

Schema lives in `apps/web/lib/db/schema.ts`. Migrations are managed by Drizzle Kit.

**After modifying `schema.ts`, always generate a migration:**

```bash
bun run --cwd apps/web db:generate   # Creates a new .sql migration file
```

Commit the generated `.sql` file alongside the schema change. **Do not use `db:push`** except for local throwaway databases.

Migrations run automatically during `bun run build` (via `lib/db/migrate.ts`), so every Vercel deploy — both preview and production — applies pending migrations to its own database.

### Environment isolation

Neon database branching is enabled in the Vercel project settings. Every preview deployment automatically gets its own isolated database branch forked from production. This means preview deployments never read or write production data. Production deployments use the main Neon database.

## Commands

```bash
# Development
turbo dev              # Run CLI agent (from root)
bun run cli            # Alternative: run CLI directly
bun run web            # Run web app
bun run web:bot       # Run web app with agent auth bootstrap defaults enabled

# Quality checks (REQUIRED after making any changes)
bun run ci                                 # Required: run format check, lint, typecheck, and tests
turbo typecheck                            # Type check all packages
turbo lint                                 # Lint all packages with oxlint
turbo lint:fix                             # Lint and auto-fix all packages

# Filter by package (use --filter)
turbo typecheck --filter=web               # Type check web app only
turbo typecheck --filter=@open-harness/cli # Type check CLI only
turbo lint:fix --filter=web                # Lint web app only
turbo lint:fix --filter=@open-harness/cli  # Lint CLI only

# Formatting (Biome - run from root)
bun run format                             # Format all files
bun run format:check                       # Check formatting without writing

# Testing
bun test                        # Run all tests
bun test path/to/file.test.ts   # Run single test file
bun test --watch                # Watch mode
```

**CI/script execution rules:**

- Run project checks through package scripts (for example `bun run ci`, `bun run --cwd apps/web db:check`).
- Prefer `bun run <script>` over invoking tool binaries directly (`bunx`, `bun x`, `tsc`, `eslint`, etc.) so local runs match CI behavior.

## Agent-browser authenticated web validation

Use `bun run web:bot` (from repo root) when a bot/agent needs to run authenticated web checks automatically.

When to use each dev command:

- `bun run web`: normal development and manual login flows.
- `bun run web:bot`: automated/headless validation where the bot should bootstrap into an authenticated session.

`bun run web:bot` runs the web app with local agent-auth defaults:

- `AGENT_WEB_AUTH_ENABLED=true`
- `AGENT_WEB_AUTH_CODE=${AGENT_WEB_AUTH_CODE:-local-agent-code}`
- `AGENT_WEB_AUTH_USER_ID=${AGENT_WEB_AUTH_USER_ID:-agent-user}`
- `JWE_SECRET=${JWE_SECRET:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY}`

Prerequisites for successful auth bootstrap:

- `POSTGRES_URL` must be set (web app DB access is required).
- `AGENT_WEB_AUTH_USER_ID` must refer to an existing user row.

The bootstrap endpoint is:

- `GET /api/auth/agent/signin?code=<AGENT_WEB_AUTH_CODE>&next=/sessions`

Notes:

- This endpoint is intentionally disabled unless `AGENT_WEB_AUTH_ENABLED=true`.
- It returns `404` in production deployments.

Recommended automated flow:

1. Start server with `bun run web:bot`.
2. Open the bootstrap URL above in `agent-browser`.
3. Confirm authenticated state via `/api/auth/info` (`user` should be present).
4. Navigate to the page under test.

## Git Commands

**Quote paths with special characters**: File paths containing brackets (like Next.js dynamic routes `[id]`, `[slug]`) are interpreted as glob patterns by zsh. Always quote these paths in git commands:

```bash
# Wrong - zsh interprets [id] as a glob pattern
git add apps/web/app/tasks/[id]/page.tsx
# Error: no matches found: apps/web/app/tasks/[id]/page.tsx

# Correct - quote the path
git add "apps/web/app/tasks/[id]/page.tsx"
```

## Architecture (Summary)

```
CLI (apps/cli) -> TUI (packages/tui) -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

See [Architecture & Workspace Structure](docs/agents/architecture.md) for details.

## Code Style (Summary)

- **Bun exclusively** (not Node/npm/pnpm)
- **Files**: kebab-case, **Types**: PascalCase, **Functions**: camelCase
- **Never use `any`** -- use `unknown` and narrow with type guards
- **No `.js` extensions** in imports
- **Biome** for formatting (double quotes, 2-space indent)
- **Zod** schemas for validation, derive types with `z.infer`

See [Code Style & Patterns](docs/agents/code-style.md) for full conventions, tool implementation patterns, and dependency patterns.
