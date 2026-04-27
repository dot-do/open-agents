import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createTemplate,
  listTemplates,
  type CreateTemplateInput,
} from "@/lib/session-templates";
import { validateBody } from "@/lib/validation";

const createTemplateSchema = z.object({
  name: z.string().min(1, "name is required").max(100),
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
    const { data: body, response } = await validateBody(req, createTemplateSchema);
    if (response) return response;
    const template = await createTemplate(ctx, body as CreateTemplateInput);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
