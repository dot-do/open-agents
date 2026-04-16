import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, tenants, users } from "@/lib/db/schema";

/**
 * Resolve the tenant slug for a given legacy `/[username]` URL segment.
 *
 * Joins users → memberships → tenants and picks the *oldest* membership
 * (i.e. the user's primary tenant). Returns `null` when the user does not
 * exist or has no tenant membership, so callers can fall through to the
 * legacy `/[username]` route rather than 308-redirecting into a 404.
 *
 * This is used by `apps/web/app/[username]/layout.tsx` to 308-redirect
 * legacy routes to `/t/[tenantSlug]/...`. Gated behind
 * `DISABLE_LEGACY_USERNAME_ROUTES` (default true).
 */
export async function resolveTenantSlugFromUsername(
  username: string,
): Promise<string | null> {
  if (!username) return null;

  const rows = await db
    .select({ slug: tenants.slug, createdAt: memberships.createdAt })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(users.username, username))
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  return rows[0]?.slug ?? null;
}
