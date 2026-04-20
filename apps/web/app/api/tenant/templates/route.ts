import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createTemplate,
  listTemplates,
  type CreateTemplateInput,
} from "@/lib/session-templates";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    const templates = await listTemplates(ctx);
    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as CreateTemplateInput | null;
    if (!body || !body.name || typeof body.name !== "string") {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }
    const template = await createTemplate(ctx, body);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
