import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import type { Session } from "./types";

/**
 * Resolve the active tenant id from a session without requiring a
 * `NextRequest` (unlike `requireTenantCtx`).
 *
 * Returns `null` when no authenticated session or no tenant membership
 * exists — callers should treat this as "unauthenticated / no tenant"
 * and degrade gracefully (e.g. skip plan-aware filtering).
 */
export async function resolveTenantId(
  session: Pick<Session, "user" | "activeTenantId"> | null | undefined,
): Promise<string | null> {
  if (!session?.user?.id) return null;

  if (session.activeTenantId) return session.activeTenantId;

  // Fallback: first membership, same as requireTenantCtx.
  const rows = await db
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, session.user.id))
    .orderBy(memberships.createdAt)
    .limit(1);

  return rows[0]?.tenantId ?? null;
}
