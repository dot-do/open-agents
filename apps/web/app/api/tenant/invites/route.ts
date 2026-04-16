import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { createInvite, listInvites } from "@/lib/invites";
import { withRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole, type Role } from "@/lib/rbac";

const VALID_ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export async function GET(req: NextRequest): Promise<Response> {
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const email =
      body && typeof body === "object" && "email" in body
        ? (body as { email?: unknown }).email
        : undefined;
    const role =
      body && typeof body === "object" && "role" in body
        ? (body as { role?: unknown }).role
        : undefined;
    if (typeof email !== "string" || email.trim().length === 0) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    if (typeof role !== "string" || !VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const result = await createInvite(ctx, { email, role: role as Role });
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

export const POST = withRateLimit(postHandler, { category: "invites:write" });
