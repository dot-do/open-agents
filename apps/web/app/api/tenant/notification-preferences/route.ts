import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  EVENT_LABELS,
  getPrefs,
  updatePref,
  type NotificationChannel,
} from "@/lib/notification-prefs";
import { withRateLimit, withReadRateLimit } from "@/lib/rate-limit";

const VALID_CHANNELS: NotificationChannel[] = ["email", "none"];

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const { event, channel } = body as { event?: unknown; channel?: unknown };

    if (typeof event !== "string" || !event) {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    if (
      typeof channel !== "string" ||
      !VALID_CHANNELS.includes(channel as NotificationChannel)
    ) {
      return NextResponse.json(
        { error: "channel must be 'email' or 'none'" },
        { status: 400 },
      );
    }

    await updatePref(
      ctx.tenantId,
      ctx.userId,
      event,
      channel as NotificationChannel,
    );

    return NextResponse.json({ ok: true, event, channel });
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
