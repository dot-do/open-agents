import "server-only";

import type { TenantContext } from "@/lib/db/tenant-context";

/**
 * Role-based access helpers. Mirrors the `memberships.role` enum. Higher rank
 * = more privilege. `requireRole` throws an `RbacError` with `.status = 403`
 * which callers should map to a NextResponse 403 (see
 * `app/api/tenant/members/**`).
 *
 * TODO: the following routes (owned by other agents) should adopt
 * `requireRole` / the sugar helpers below once their wave lands:
 *   - /api/tenant/keys/**           -> canManageKeys (admin+)
 *   - /api/tenant/billing/**        -> canManageBilling (admin+)
 *   - /api/tenant/settings (mutate) -> canWrite (member+)
 */

export type Role = "owner" | "admin" | "member" | "viewer";

const RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  viewer: 0,
};

export class RbacError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "RbacError";
  }
}

export function rankOf(role: Role): number {
  return RANK[role];
}

export function hasRole(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function requireRole(
  ctx: Pick<TenantContext, "role">,
  min: Role,
): void {
  if (!hasRole(ctx.role, min)) {
    throw new RbacError(
      `role '${ctx.role}' is insufficient (requires '${min}' or higher)`,
    );
  }
}

export function canManageMembers(role: Role): boolean {
  return hasRole(role, "admin");
}

export function canManageBilling(role: Role): boolean {
  return hasRole(role, "admin");
}

export function canManageKeys(role: Role): boolean {
  return hasRole(role, "admin");
}

export function canWrite(role: Role): boolean {
  return hasRole(role, "member");
}
