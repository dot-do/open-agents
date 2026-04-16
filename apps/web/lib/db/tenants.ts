import { eq } from "drizzle-orm";
import { db } from "./client";
import { tenants, type Tenant } from "./schema";

/**
 * Look up a tenant by its URL slug (the `/[tenantSlug]/…` route segment).
 *
 * Returns undefined for unknown slugs; callers are expected to 404/redirect.
 * Membership is NOT enforced here — see `requireTenantCtx` / the
 * `/[tenantSlug]/layout.tsx` guard for the access check.
 */
export async function lookupTenantBySlug(
  slug: string,
): Promise<Tenant | undefined> {
  if (!slug) return undefined;
  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0];
}
