import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { deleteWebhook, updateWebhook } from "@/lib/webhooks";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      url?: string;
      events?: string[];
      enabled?: boolean;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const updated = await updateWebhook(ctx, id, body);
    if (!updated) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ webhook: updated });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const ok = await deleteWebhook(ctx, id);
    if (!ok) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
