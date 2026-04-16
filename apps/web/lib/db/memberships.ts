import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { memberships, tenants, users } from "./schema";
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

export type TenantMemberRow = {
  userId: string;
  role: SessionRole;
  createdAt: Date;
  email: string | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
};

export async function listMembershipsForTenant(
  tenantId: string,
): Promise<TenantMemberRow[]> {
  const rows = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      createdAt: memberships.createdAt,
      email: users.email,
      username: users.username,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role as SessionRole,
    createdAt: r.createdAt,
    email: r.email,
    username: r.username,
    name: r.name,
    avatarUrl: r.avatarUrl,
  }));
}

export async function countOwners(tenantId: string): Promise<number> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")),
    );
  return rows.length;
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
