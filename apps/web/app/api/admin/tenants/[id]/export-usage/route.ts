import { type NextRequest } from "next/server";
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

function todayUTC(): string {
  return daysAgoUTC(0);
}

/**
 * GET /api/admin/tenants/[id]/export-usage?format=csv
 *
 * Returns CSV of daily usage for the last 30 days. Admin-only.
 * Columns: date, sandbox_minutes, cost_cents, tokens_in, tokens_out
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { "content-type": "application/json" },
      });
    }
    throw error;
  }

  const { id } = await params;

  // Look up tenant for slug (used in filename)
  const [tenantRow] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenantRow) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
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

  const header = "date,sandbox_minutes,cost_cents,tokens_in,tokens_out";
  const csvRows = rows.map(
    (r) => `${r.date},${r.sandboxMinutes},${r.costCents},0,0`,
  );
  const csv = [header, ...csvRows].join("\n") + "\n";

  const filename = `tenant-usage-${tenantRow.slug}-${todayUTC()}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
