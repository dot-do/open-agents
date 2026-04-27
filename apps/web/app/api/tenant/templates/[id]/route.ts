import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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
import { validateBody } from "@/lib/validation";

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  modelId: z.string().max(100).nullable().optional(),
  systemPrompt: z.string().max(10000).nullable().optional(),
  skillRefs: z.array(z.object({
    slug: z.string().max(100),
    version: z.string().max(50).optional(),
  })).max(50).nullable().optional(),
});

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
    const { data: body, response } = await validateBody(req, updateTemplateSchema);
    if (response) return response;
    const template = await updateTemplate(ctx, id, body as UpdateTemplateInput);
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
