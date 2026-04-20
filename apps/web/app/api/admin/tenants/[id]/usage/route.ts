import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db/client";
import { tenantUsageCounters, tenants } from "@/lib/db/schema";

function daysAgoUTC(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/admin/tenants/[id]/usage
 *
 * Returns last 30 days of daily usage data + totals. Admin-only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const { id } = await params;

  // Verify tenant exists
  const [tenantRow] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenantRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const since = daysAgoUTC(30);
  const rows = await db
    .select({
      date: tenantUsageCounters.periodStart,
      sandboxMinutes: tenantUsageCounters.sandboxMinutes,
      costCents: tenantUsageCounters.costCents,
    })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, id),
        gte(tenantUsageCounters.periodStart, since),
      ),
    )
    .orderBy(asc(tenantUsageCounters.periodStart));

  const daily = rows.map((r) => ({
    date: r.date,
    sandboxMinutes: r.sandboxMinutes,
    costCents: r.costCents,
  }));

  const totals = {
    sandboxMinutes: daily.reduce((sum, d) => sum + d.sandboxMinutes, 0),
    costCents: daily.reduce((sum, d) => sum + d.costCents, 0),
    days: daily.length,
  };

  return NextResponse.json({ daily, totals });
}
