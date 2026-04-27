import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { withReadRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation";
import {
  createWebhook,
  listRecentDeliveries,
  listWebhooks,
} from "@/lib/webhooks";

const createWebhookSchema = z.object({
  url: z.string().url("invalid webhook URL").max(2000),
  events: z.array(z.string().max(100)).min(1, "at least one event is required").max(50),
  secret: z.string().max(500).optional(),
});

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

async function getHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    const url = new URL(req.url);
    if (url.searchParams.get("include") === "deliveries") {
      const [webhooks, deliveries] = await Promise.all([
        listWebhooks(ctx),
        listRecentDeliveries(ctx, 20),
      ]);
      return NextResponse.json({ webhooks, deliveries });
    }
    const webhooks = await listWebhooks(ctx);
    return NextResponse.json({ webhooks });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withReadRateLimit(getHandler);

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { data: body, response } = await validateBody(req, createWebhookSchema);
    if (response) return response;
    const result = await createWebhook(ctx, {
      url: body.url,
      events: body.events,
      secret: body.secret,
    });
    // The plaintext secret is returned exactly once.
    return NextResponse.json(
      { webhook: result.webhook, secret: result.secret },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
