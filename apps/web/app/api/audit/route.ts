import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * GET /api/audit?limit=100&before=<ISO-8601>
 *
 * Returns this tenant's audit events ordered newest-first. The `before`
 * cursor is the `createdAt` of the last row from the previous page (ISO
 * string). Capped at 200 rows per request.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const rawBefore = url.searchParams.get("before");

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid limit" }, { status: 400 });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  let before: Date | null = null;
  if (rawBefore) {
    const d = new Date(rawBefore);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "invalid before cursor" }, { status: 400 });
    }
    before = d;
  }

  const where = before
    ? and(eq(auditEvents.tenantId, ctx.tenantId), lt(auditEvents.createdAt, before))
    : eq(auditEvents.tenantId, ctx.tenantId);

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorUserId: auditEvents.actorUserId,
      target: auditEvents.target,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  const nextBefore =
    rows.length === limit ? rows[rows.length - 1]?.createdAt.toISOString() : null;

  return NextResponse.json({
    events: rows,
    pagination: {
      limit,
      nextBefore,
    },
  });
}
