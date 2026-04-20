import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  deleteTemplate,
  getTemplate,
  updateTemplate,
  type UpdateTemplateInput,
} from "@/lib/session-templates";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    const { id } = await params;
    const template = await getTemplate(ctx, id);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as UpdateTemplateInput | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const template = await updateTemplate(ctx, id, body);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const existed = await getTemplate(ctx, id);
    if (!existed) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await deleteTemplate(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
