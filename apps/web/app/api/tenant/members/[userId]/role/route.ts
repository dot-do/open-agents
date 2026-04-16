import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { countOwners } from "@/lib/db/memberships";
import { memberships } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { withRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole, type Role } from "@/lib/rbac";

const VALID_ROLES: Role[] = ["owner", "admin", "member", "viewer"];

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const nextRole =
      body && typeof body === "object" && "role" in body
        ? (body as { role?: unknown }).role
        : undefined;
    if (
      typeof nextRole !== "string" ||
      !VALID_ROLES.includes(nextRole as Role)
    ) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

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
