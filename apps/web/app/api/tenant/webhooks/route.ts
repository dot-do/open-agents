import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createWebhook,
  listRecentDeliveries,
  listWebhooks,
} from "@/lib/webhooks";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest): Promise<Response> {
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

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as {
      url?: string;
      events?: string[];
      secret?: string;
    } | null;
    if (!body || typeof body.url !== "string" || !Array.isArray(body.events)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
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
