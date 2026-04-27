import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { createInvite, listInvites } from "@/lib/invites";
import { withRateLimit, withReadRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole, type Role } from "@/lib/rbac";
import { validateBody } from "@/lib/validation";

const VALID_ROLES: Role[] = ["owner", "admin", "member", "viewer"];

const inviteSchema = z.object({
  email: z.string().email("invalid email format").max(320),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

async function getHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    const invites = await listInvites(ctx);
    return NextResponse.json({ invites });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

async function postHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");

    const { data, response } = await validateBody(req, inviteSchema);
    if (response) return response;

    const result = await createInvite(ctx, { email: data.email, role: data.role as Role });
    return NextResponse.json({
      id: result.id,
      acceptUrl: result.acceptUrl,
    });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export const GET = withReadRateLimit(getHandler);

export const POST = withRateLimit(postHandler, { category: "invites:write" });
