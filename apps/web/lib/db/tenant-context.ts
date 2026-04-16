import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * Tenancy query guard.
 *
 * CONTRACT: every mutating query in `app/api/**` that touches a tenant-scoped
 * table MUST derive its `tenantId` from `requireTenantCtx(req)` and pass the
 * resulting `TenantContext` into query helpers via `withTenant`. This keeps
 * tenant isolation enforceable at the call site rather than via ambient
 * globals. See `apps/web/lib/db/schema.ts` top-of-file note for the list of
 * tenant-scoped tables.
 *
 * `withTenant` is currently a thin passthrough — it exists to give query
 * callers a single place to hang auditing / RLS-style checks as the tenancy
 * model matures, without having to re-thread every call site later.
 */

export type Role = "owner" | "admin" | "member" | "viewer";

export type TenantContext = {
  tenantId: string;
  userId: string;
  role: Role;
};

export class TenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}

/**
 * Resolve the active tenant for an incoming request.
 *
 * TODO(tenancy): once the session payload carries an `activeTenantId` we
 * should honor it here. Until then we fall back to the user's personal
 * tenant (the first membership row, which for now is their owner seat
 * created by the 0030_tenancy_backfill migration).
 */
export async function requireTenantCtx(
  req: NextRequest,
): Promise<TenantContext> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    throw new TenantAccessError("No authenticated user on request");
  }

  // TODO(tenancy): read `session.activeTenantId` once the session type is
  // extended; for now pick the first membership (personal tenant).
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(
      `User ${userId} has no tenant memberships`,
    );
  }

  return {
    tenantId: row.tenantId,
    userId,
    role: row.role as Role,
  };
}

/**
 * Assert that the caller's context matches an explicit tenantId — useful when
 * an API route receives a tenant id in the URL or request body.
 */
export async function assertTenantMember(
  userId: string,
  tenantId: string,
): Promise<Role> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(
      `User ${userId} is not a member of tenant ${tenantId}`,
    );
  }
  return row.role as Role;
}

/**
 * Thin passthrough today — see file-level contract note. Wrap tenant-scoped
 * query callbacks so the call site is syntactically marked as tenant-aware:
 *
 *   const rows = await withTenant(ctx, () =>
 *     db.select().from(sessions).where(eq(sessions.tenantId, ctx.tenantId)),
 *   );
 */
export async function withTenant<T>(
  _ctx: TenantContext,
  query: () => Promise<T>,
): Promise<T> {
  return query();
}
