import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { memberships, tenants, type Tenant } from "@/lib/db/schema";

export type CreateTenantInput = {
  name: string;
  slug: string;
  ownerUserId: string;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function normalizeSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length >= 1 ? s : "workspace";
}

/**
 * Resolve a collision-safe slug by appending `-<n>` when the base is taken.
 * Mirrors the strategy used in `0030_tenancy_backfill.sql`.
 */
async function resolveAvailableSlug(base: string): Promise<string> {
  const normalized = normalizeSlug(base);
  let candidate = normalized;
  for (let n = 2; n < 1000; n++) {
    const [row] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, candidate))
      .limit(1);
    if (!row) return candidate;
    candidate = `${normalized}-${n}`;
  }
  // Absolute fallback — random suffix.
  return `${normalized}-${nanoid(6).toLowerCase()}`;
}

/**
 * Create a new tenant, owner membership, optional Stripe customer, and audit
 * event. Slug collisions are resolved automatically by appending `-<n>`.
 */
export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const name = input.name.trim() || "Workspace";
  const slug = await resolveAvailableSlug(input.slug || name);
  const id = `ten_${nanoid(21)}`;

  const [tenant] = await db
    .insert(tenants)
    .values({ id, slug, name })
    .returning();

  if (!tenant) {
    throw new Error("Failed to create tenant");
  }

  await db
    .insert(memberships)
    .values({
      tenantId: tenant.id,
      userId: input.ownerUserId,
      role: "owner",
    })
    .onConflictDoNothing({
      target: [memberships.tenantId, memberships.userId],
    });

  // Best-effort Stripe customer creation. Tolerates missing config so the
  // non-billing path (dev, self-hosted without Stripe) still succeeds.
  try {
    const { ensureStripeCustomer } = await import("@/lib/billing");
    await ensureStripeCustomer({
      tenantId: tenant.id,
      userId: input.ownerUserId,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "tenants.ensure_stripe_customer_skipped",
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  try {
    const { audit } = await import("@/lib/audit");
    await audit(
      { tenantId: tenant.id, userId: input.ownerUserId },
      "tenant.created",
      { target: tenant.id, metadata: { slug: tenant.slug, name: tenant.name } },
    );
  } catch {
    // audit.ts already swallows errors internally; guard lazy-import failure.
  }

  return tenant;
}

/**
 * Create a personal tenant for a newly onboarded user. Slug is derived from
 * the username and resolved against collisions.
 */
export async function createPersonalTenantForUser(user: {
  id: string;
  username: string;
  name?: string | null;
}): Promise<Tenant> {
  const displayName = (user.name && user.name.trim()) || user.username;
  return createTenant({
    name: displayName,
    slug: user.username,
    ownerUserId: user.id,
  });
}
