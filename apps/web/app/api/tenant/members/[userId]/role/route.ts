import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { countOwners } from "@/lib/db/memberships";
import { memberships } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { withRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole, type Role } from "@/lib/rbac";
import { validateBody } from "@/lib/validation";

const VALID_ROLES: Role[] = ["owner", "admin", "member", "viewer"];

const changeRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

async function safeAudit(
  ctx: { tenantId: string; userId: string },
  action: string,
  opts?: { target?: string; metadata?: unknown },
): Promise<void> {
  try {
    const mod = await import("@/lib/audit").catch(() => null);
    if (mod && typeof mod.audit === "function") {
      await mod.audit(ctx, action, opts);
    }
  } catch {
    // best-effort
  }
}

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    // Role changes are owner-only.
    requireRole(ctx, "owner");
    const { userId } = await params;

    const { data, response } = await validateBody(req, changeRoleSchema);
    if (response) return response;
    const nextRole = data.role;

    const [target] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, ctx.tenantId),
          eq(memberships.userId, userId),
        ),
      )
      .limit(1);
    if (!target) {
      return NextResponse.json({ error: "not a member" }, { status: 404 });
    }

    // Block demoting the last owner.
    if (target.role === "owner" && nextRole !== "owner") {
      const owners = await countOwners(ctx.tenantId);
      if (owners <= 1) {
        return NextResponse.json(
          { error: "cannot demote the last owner" },
          { status: 400 },
        );
      }
    }

    await db
      .update(memberships)
      .set({ role: nextRole as Role })
      .where(
        and(
          eq(memberships.tenantId, ctx.tenantId),
          eq(memberships.userId, userId),
        ),
      );

    await safeAudit(ctx, "member.role_changed", {
      target: userId,
      metadata: { from: target.role, to: nextRole },
    });

    return NextResponse.json({ ok: true, role: nextRole });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export const PATCH = withRateLimit(patchHandler, {
  category: "members:write",
});
