import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/db/tenant-context";

export class TransferError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TransferError";
    this.status = status;
  }
}

/**
 * Transfer ownership of a tenant from the current owner to another member.
 *
 * Requires `ctx.role === 'owner'`. The new owner must already be a member of
 * the tenant. The current owner is demoted to 'admin'; the new owner is
 * promoted to 'owner'.
 *
 * Audits `tenant.ownership_transferred` with before/after metadata.
 */
export async function transferOwnership(
  ctx: TenantContext,
  newOwnerUserId: string,
): Promise<{ previousOwner: string; newOwner: string }> {
  if (ctx.role !== "owner") {
    throw new TransferError(
      "only the current owner can transfer ownership",
      403,
    );
  }

  if (newOwnerUserId === ctx.userId) {
    throw new TransferError("cannot transfer ownership to yourself");
  }

  // Verify the new owner is a current member.
  const [targetMembership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, ctx.tenantId),
        eq(memberships.userId, newOwnerUserId),
      ),
    )
    .limit(1);

  if (!targetMembership) {
    throw new TransferError(
      "target user is not a member of this workspace",
      404,
    );
  }

  const previousRole = targetMembership.role;

  // Demote current owner to admin.
  await db
    .update(memberships)
    .set({ role: "admin" })
    .where(
      and(
        eq(memberships.tenantId, ctx.tenantId),
        eq(memberships.userId, ctx.userId),
      ),
    );

  // Promote new owner.
  await db
    .update(memberships)
    .set({ role: "owner" })
    .where(
      and(
        eq(memberships.tenantId, ctx.tenantId),
        eq(memberships.userId, newOwnerUserId),
      ),
    );

  await audit(ctx, "tenant.ownership_transferred", {
    target: newOwnerUserId,
    metadata: {
      previousOwner: ctx.userId,
      newOwner: newOwnerUserId,
      previousOwnerNewRole: "admin",
      newOwnerPreviousRole: previousRole,
    },
  });

  return { previousOwner: ctx.userId, newOwner: newOwnerUserId };
}
