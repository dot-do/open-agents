import { and, eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import type { TenantContext } from "@/lib/db/tenant-context";

/**
 * Tenant-guard query helpers (wave 3).
 *
 * Purpose: prevent "forgot to add eq(table.tenantId, ctx.tenantId)" bugs by
 * routing common CRUD through a thin wrapper that auto-injects the tenant
 * predicate. This is NOT a query-builder replacement — complex joins,
 * aggregates, upserts, etc. should continue to use Drizzle directly (and
 * pass `ctx.tenantId` explicitly).
 *
 * Defense-in-depth layering:
 *   1. scopedQuery / enforceTenantEq (this file) — primary, app-level.
 *   2. Postgres RLS policies (0034_tenant_rls.sql) — secondary, keyed on
 *      `current_setting('app.tenant_id', true)::text`. Primed per-tx via
 *      `setTenantContext(db, tenantId)` in `./rls.ts`.
 *
 * Never instrument Drizzle internals globally — it couples us to private
 * APIs that change between minor versions.
 */

// Any table that has a `tenantId` column. We rely on structural typing so
// both existing tables (sessions, chats, …) and new wave-3 tables work
// without per-table generics. Drizzle's inferred column types are complex
// enough that narrow generics here end up more fragile than useful — the
// helpers below intentionally use loose typing at the Drizzle boundary.
export type TenantScopedTable = PgTable & {
  // biome-ignore lint/suspicious/noExplicitAny: intentional structural escape hatch
  tenantId: any;
};

type Row = Record<string, unknown> & { tenantId?: string | null };

/**
 * Assert a loaded row belongs to the expected tenant. In development this
 * throws; in production it logs a metric-friendly warning and returns so
 * the caller can decide. Use at trust boundaries (e.g. after raw SQL).
 */
export function enforceTenantEq<R extends Row>(
  tenantId: string,
  row: R | null | undefined,
): R | null | undefined {
  if (!row) return row;
  if (row.tenantId === tenantId) return row;
  const msg = `tenant-guard: mismatch — expected ${tenantId}, row has ${String(
    row.tenantId,
  )}`;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(msg);
  }
  // eslint-disable-next-line no-console
  console.warn(`[tenant-guard.metric] ${msg}`);
  return row;
}

export type ScopedQuery = {
  tenantId: string;
  selectFrom: (table: TenantScopedTable, where?: SQL | undefined) => unknown;
  insertInto: (
    table: TenantScopedTable,
    values: Record<string, unknown> | Record<string, unknown>[],
  ) => unknown;
  updateSet: (
    table: TenantScopedTable,
    where: SQL | undefined,
    values: Record<string, unknown>,
  ) => unknown;
  deleteFrom: (table: TenantScopedTable, where?: SQL | undefined) => unknown;
};

/**
 * Build a tenant-scoped query helper bound to a `TenantContext`. All
 * select/update/delete calls auto-inject `eq(table.tenantId, ctx.tenantId)`;
 * inserts auto-stamp `tenantId` onto each row (callers may omit it).
 *
 * Return types are intentionally `unknown` — callers chain Drizzle
 * builders off the return value (`.limit`, `.returning`, `.orderBy`, etc.),
 * and Drizzle's inferred builder types are extremely wide. Cast at the
 * call site when you need a narrower type.
 */
export function scopedQuery(ctx: Pick<TenantContext, "tenantId">): ScopedQuery {
  const tenantId = ctx.tenantId;
  const tenantCol = (t: TenantScopedTable) => t.tenantId;
  return {
    tenantId,
    selectFrom(table, where) {
      const predicate = where
        ? and(eq(tenantCol(table), tenantId), where)
        : eq(tenantCol(table), tenantId);
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle builder type
      return (db.select().from(table as any) as any).where(predicate);
    },
    insertInto(table, values) {
      const rows = Array.isArray(values) ? values : [values];
      const stamped = rows.map((r) => ({ ...r, tenantId }));
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle insert values type
      return db.insert(table).values(stamped as any);
    },
    updateSet(table, where, values) {
      // Strip tenantId from updates — callers shouldn't re-parent via this helper.
      const { tenantId: _drop, ...safe } = values;
      void _drop;
      const predicate = where
        ? and(eq(tenantCol(table), tenantId), where)
        : eq(tenantCol(table), tenantId);
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle set() type
      return db.update(table).set(safe as any).where(predicate);
    },
    deleteFrom(table, where) {
      const predicate = where
        ? and(eq(tenantCol(table), tenantId), where)
        : eq(tenantCol(table), tenantId);
      return db.delete(table).where(predicate);
    },
  };
}
