import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { countOwners } from "@/lib/db/memberships";
import { memberships } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { RbacError, requireRole } from "@/lib/rbac";

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
    // audit is best-effort
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    const { userId } = await params;

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

    // Block removing the last owner.
    if (target.role === "owner") {
      const owners = await countOwners(ctx.tenantId);
      if (owners <= 1) {
        return NextResponse.json(
          { error: "cannot remove the last owner" },
          { status: 400 },
        );
      }
      // Only owners can remove owners.
      if (ctx.role !== "owner") {
        return NextResponse.json(
          { error: "only owners can remove owners" },
          { status: 403 },
        );
      }
    }

    await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.tenantId, ctx.tenantId),
          eq(memberships.userId, userId),
        ),
      );

    await safeAudit(ctx, "member.removed", {
      target: userId,
      metadata: { role: target.role },
    });

    return NextResponse.json({ ok: true });
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
