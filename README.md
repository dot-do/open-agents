# Open Harness

An AI coding agent built with AI SDK.

## Prerequisites

- [Bun](https://bun.sh) v1.2.14+
- [Vercel CLI](https://vercel.com/docs/cli) (for token management)
- PostgreSQL database

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Set up environment variables

Copy the example env files:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/cli/.env.example apps/cli/.env
```

Edit `apps/web/.env` and fill in your values:

- `POSTGRES_URL` - Your PostgreSQL connection string
- `ENCRYPTION_KEY`, `CLI_TOKEN_ENCRYPTION_KEY`, `JWE_SECRET` - Generate with `openssl rand -base64 32`
- `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - From your GitHub OAuth app

### 3. Link Vercel project and pull tokens

```bash
vc link
```

When prompted, select the `vercel-labs/open-harness-web` project.

Then pull the tokens:

```bash
./scripts/refresh-vercel-token.sh
```

This pulls `VERCEL_OIDC_TOKEN` and `BLOB_READ_WRITE_TOKEN` from Vercel and updates your local `.env` files.

### 4. Run database migrations

```bash
cd apps/web
bun run db:migrate
```

## Development

Run the web app:

```bash
bun run web
```

Run the CLI agent:

```bash
bun run cli
```

Run both with Turbo:

```bash
turbo dev
```

## Project structure

```
apps/
  cli/           # CLI entry point
  web/           # Web interface
packages/
  agent/         # Core agent logic
  sandbox/       # Sandbox abstraction
  tui/           # Terminal UI
  shared/        # Shared utilities
```

See [AGENTS.md](./AGENTS.md) for more details on the architecture and development workflow.
