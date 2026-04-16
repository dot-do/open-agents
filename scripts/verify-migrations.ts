/**
 * Verify that all Drizzle migrations apply cleanly from an empty Postgres
 * and that the resulting schema matches `apps/web/lib/db/schema.ts`.
 *
 * Strategy: this script assumes an empty Postgres database is reachable at
 * `$POSTGRES_URL`. In CI that's provided by a `postgres:16` service
 * container. Locally, developers can point it at a throwaway database
 * (see docs/SELF_HOST_MULTITENANT.md → "Verifying migrations").
 *
 * Steps:
 *   1. Confirm the target DB has no `public.*` user tables (empty).
 *   2. Run `bun run --cwd apps/web db:migrate:apply` (drizzle migrate).
 *   3. Run `bun run --cwd apps/web db:check` (drift detection).
 *   4. Run a couple of sanity COUNT(*) queries on core tenancy tables.
 *
 * Any failure exits non-zero with a clear message. No ephemeral docker or
 * heavy embedded-postgres dependency is introduced — CI provides Postgres.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";

const REPO_ROOT = join(import.meta.dirname, "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error(
    "❌ POSTGRES_URL not set. Point at an empty Postgres database before running.\n" +
      "   Example (local): POSTGRES_URL=postgres://postgres:postgres@localhost:5432/verify bun run verify:migrations",
  );
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`\n$ (cd ${cwd} && ${cmd} ${args.join(" ")})`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`❌ Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

const client = postgres(url, { max: 1 });

try {
  // 1. Confirm empty (no user tables in the `public` schema).
  const rows = (await client.unsafe(`
    SELECT COUNT(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)) as Array<{ n: number }>;
  const existingTables = rows[0]?.n ?? 0;
  if (existingTables > 0) {
    console.error(
      `❌ Target database is not empty (${existingTables} tables in "public"). ` +
        "Point POSTGRES_URL at a fresh database to verify from-scratch migrations.",
    );
    process.exit(1);
  }
  console.log("✓ Target database is empty");

  // Close before spawning migrate (which opens its own connection).
  await client.end();

  // 2. Apply all migrations.
  run("bun", ["run", "db:migrate:apply"], WEB_DIR);

  // 3. Drift check.
  run("bun", ["run", "db:check"], WEB_DIR);

  // 4. Sanity queries.
  const sanityClient = postgres(url, { max: 1 });
  try {
    const [{ n: tenantCount }] = (await sanityClient.unsafe(
      "SELECT COUNT(*)::int AS n FROM tenants",
    )) as Array<{ n: number }>;
    const [{ n: membershipCount }] = (await sanityClient.unsafe(
      "SELECT COUNT(*)::int AS n FROM memberships",
    )) as Array<{ n: number }>;

    if (tenantCount !== 0 || membershipCount !== 0) {
      console.error(
        `❌ Expected zero rows post-migration, got tenants=${tenantCount} memberships=${membershipCount}`,
      );
      process.exit(1);
    }

    // Verify migration history has all 35+ migrations recorded.
    const [{ n: migrationCount }] = (await sanityClient.unsafe(
      'SELECT COUNT(*)::int AS n FROM drizzle."__drizzle_migrations"',
    )) as Array<{ n: number }>;
    console.log(
      `✓ Sanity queries ok (tenants=0, memberships=0, migrations=${migrationCount})`,
    );
    if (migrationCount < 35) {
      console.error(
        `❌ Expected at least 35 migrations recorded, found ${migrationCount}`,
      );
      process.exit(1);
    }
  } finally {
    await sanityClient.end();
  }

  console.log("\n✅ Migrations apply cleanly from an empty database");
} catch (error) {
  console.error("❌ verify-migrations failed:", error);
  try {
    await client.end();
  } catch {
    // ignore
  }
  process.exit(1);
}
