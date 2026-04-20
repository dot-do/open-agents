import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, ilike, lt, sql } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db/client";
import {
  tenantWebhookDeliveries,
  tenantWebhooks,
  tenants,
} from "@/lib/db/schema";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * GET /api/admin/webhooks?status=&tenant=&event=&limit=50&before=
 *
 * Cross-tenant webhook delivery log. Read-only, admin-only.
 * Cursor-based pagination using `before` (ISO timestamp of createdAt).
 */
export async function GET(req: NextRequest): Promise<Response> {
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

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const tenantSearch = url.searchParams.get("tenant")?.trim() ?? "";
  const eventFilter = url.searchParams.get("event")?.trim() ?? "";
  const before = url.searchParams.get("before") ?? "";
  const rawLimit = url.searchParams.get("limit");

  let limit = DEFAULT_LIMIT;
  if (rawLimit) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid limit" }, { status: 400 });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  // Build conditions
  const conditions = [];

  if (
    statusFilter &&
    ["pending", "success", "failed", "dead"].includes(statusFilter)
  ) {
    conditions.push(eq(tenantWebhookDeliveries.status, statusFilter as "pending" | "success" | "failed" | "dead"));
  }

  if (eventFilter) {
    conditions.push(eq(tenantWebhookDeliveries.event, eventFilter));
  }

  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      conditions.push(lt(tenantWebhookDeliveries.createdAt, beforeDate));
    }
  }

  // Tenant search: resolve matching tenant IDs first
  if (tenantSearch) {
    conditions.push(
      ilike(tenants.name, `%${tenantSearch}%`),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: tenantWebhookDeliveries.id,
      tenantId: tenantWebhookDeliveries.tenantId,
      tenantName: tenants.name,
      webhookUrl: tenantWebhooks.url,
      event: tenantWebhookDeliveries.event,
      status: tenantWebhookDeliveries.status,
      responseStatus: tenantWebhookDeliveries.responseStatus,
      attempts: tenantWebhookDeliveries.attempts,
      createdAt: tenantWebhookDeliveries.createdAt,
      completedAt: tenantWebhookDeliveries.completedAt,
    })
    .from(tenantWebhookDeliveries)
    .innerJoin(
      tenantWebhooks,
      eq(tenantWebhookDeliveries.webhookId, tenantWebhooks.id),
    )
    .innerJoin(tenants, eq(tenantWebhookDeliveries.tenantId, tenants.id))
    .where(where)
    .orderBy(desc(tenantWebhookDeliveries.createdAt))
    .limit(limit + 1); // fetch one extra to detect next page

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const deliveries = page.map((r) => ({
    id: r.id,
    tenantName: r.tenantName,
    webhookUrl: maskUrl(r.webhookUrl),
    event: r.event,
    status: r.status,
    responseStatus: r.responseStatus,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));

  const nextCursor =
    hasMore && page.length > 0
      ? page[page.length - 1].createdAt.toISOString()
      : null;

  return NextResponse.json({ deliveries, nextCursor });
}

/** Mask webhook URL: show scheme + host, redact path */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return "***";
  }
}
