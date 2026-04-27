import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  EVENT_LABELS,
  getPrefs,
  updatePref,
  type NotificationChannel,
} from "@/lib/notification-prefs";
import { withRateLimit, withReadRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation";

const VALID_CHANNELS: NotificationChannel[] = ["email", "none"];

const notifPrefSchema = z.object({
  event: z.string().min(1, "event is required").max(100),
  channel: z.enum(["email", "none"]),
});

async function getHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    const prefs = await getPrefs(ctx.tenantId, ctx.userId);

    // Build full list with defaults for events without explicit prefs.
    const events = DEFAULT_NOTIFICATION_EVENTS.map((event) => ({
      event,
      label: EVENT_LABELS[event] ?? event,
      channel: prefs[event] ?? "email",
    }));

    return NextResponse.json({ preferences: events });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

async function patchHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);

    const { data, response } = await validateBody(req, notifPrefSchema);
    if (response) return response;

    await updatePref(
      ctx.tenantId,
      ctx.userId,
      data.event,
      data.channel as NotificationChannel,
    );

    return NextResponse.json({ ok: true, event: data.event, channel: data.channel });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export const GET = withReadRateLimit(getHandler);
export const PATCH = withRateLimit(patchHandler, {
  category: "notification-prefs:write",
});
