import "server-only";

import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import { getSessionFromReq } from "@/lib/session/server";

/**
 * Cross-tenant admin gate.
 *
 * Admin status is conferred by listing the user's id in the
 * `ADMIN_USER_IDS` env var (comma-separated). This is intentionally a
 * static config knob and not a DB role — it gates the admin console used
 * by ops to read across tenants and to perform a small set of
 * blast-radius actions (kill sandboxes, impersonate). Tenant-scoped
 * roles (owner/admin/member/viewer) are unchanged and unrelated.
 */

export class AdminAccessError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "AdminAccessError";
  }
}

function adminUserIdSet(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return new Set(ids);
}

/**
 * True when `userId` is listed in ADMIN_USER_IDS. Returns false for
 * empty/undefined ids and for empty env. Case-sensitive match.
 */
export function isAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return adminUserIdSet().has(userId);
}

/**
 * Resolve the session from a request and assert the user is an admin.
 * Throws {@link AdminAccessError} (status 403) on failure. Returns the
 * admin's userId on success — used as the audit actor for cross-tenant
 * admin actions.
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<{ userId: string }> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    throw new AdminAccessError("unauthorized");
  }
  if (!isAdmin(userId)) {
    throw new AdminAccessError("forbidden");
  }
  return { userId };
}

/**
 * Server-component variant: resolve the cookie-backed session via
 * `getServerSession` and assert admin. Returns undefined when the caller
 * is not an admin so layouts can `redirect("/")` without throwing.
 */
export async function getAdminUserIdFromServerSession(): Promise<
  string | undefined
> {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId || !isAdmin(userId)) return undefined;
  return userId;
}
