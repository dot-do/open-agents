import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { addDomain, listDomains } from "@/lib/custom-domains";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const domains = await listDomains(ctx);
    return NextResponse.json({ domains });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as {
      domain?: string;
    } | null;
    if (!body?.domain || typeof body.domain !== "string") {
      return NextResponse.json(
        { error: "domain is required" },
        { status: 400 },
      );
    }
    const result = await addDomain(ctx, body.domain);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    // Unique constraint violation
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "Domain is already registered" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
