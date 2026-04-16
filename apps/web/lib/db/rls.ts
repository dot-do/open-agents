import { sql } from "drizzle-orm";

/**
 * RLS helper (wave 3).
 *
 * Postgres row-level security is enabled on tenant-scoped tables in
 * `0034_tenant_rls.sql`. Policies compare `tenant_id` to
 * `current_setting('app.tenant_id', true)::text`. Callers prime that GUC
 * at the start of a transaction via `setTenantContext(tx, tenantId)`.
 *
 * IMPORTANT: RLS is defense-in-depth. The primary control is the
 * application-level tenant guard in `./tenant-guard.ts`. Do not rely on
 * RLS alone — it only fires if a transaction has actually set the GUC.
 *
 * The Postgres role used by the app must have permission to `SET` custom
 * GUCs prefixed with `app.`. Supabase / Neon / RDS grant this by default
 * for the standard role; self-hosted clusters may require an explicit
 * grant or a `search_path` adjustment — see the migration header.
 */

// Minimal structural type: anything with an `.execute()` method that takes
// a drizzle SQL fragment. Works with `db` and tx handles from
// drizzle-orm/postgres-js without importing their private builder types.
export interface DrizzleExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

export async function setTenantContext(
  tx: DrizzleExecutor,
  tenantId: string,
): Promise<void> {
  // `set_config(..., true)` is the transaction-local equivalent of
  // `SET LOCAL`. Parameter-binding via drizzle's sql tag prevents
  // injection even though tenantId should already be validated upstream.
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}
