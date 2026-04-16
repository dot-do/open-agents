import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { memberships, tenants } from "./schema";
import type { SessionRole } from "@/lib/session/types";

export type UserMembership = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: SessionRole;
};

export async function listMembershipsForUser(
  userId: string,
): Promise<UserMembership[]> {
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({
    tenantId: r.tenantId,
    tenantSlug: r.tenantSlug,
    tenantName: r.tenantName,
    role: r.role as SessionRole,
  }));
}

/**
 * Returns the user's "personal" tenant row — defined as the first membership
 * created for the user, which for users seeded by the 0030_tenancy_backfill
 * migration is their owner seat on their personal tenant.
 */
export async function getDefaultMembershipForUser(
  userId: string,
): Promise<UserMembership | undefined> {
  const rows = await listMembershipsForUser(userId);
  return rows[0];
}

export async function getMembership(
  userId: string,
  tenantId: string,
): Promise<{ role: SessionRole } | undefined> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)),
    )
    .limit(1);
  const row = rows[0];
  return row ? { role: row.role as SessionRole } : undefined;
}
