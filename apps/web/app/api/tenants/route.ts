import { NextResponse, type NextRequest } from "next/server";
import { listMembershipsForUser } from "@/lib/db/memberships";
import { withRateLimit } from "@/lib/rate-limit";
import { getSessionFromReq } from "@/lib/session/server";
import { createTenant } from "@/lib/tenants";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const memberships = await listMembershipsForUser(userId);
  return NextResponse.json({
    activeTenantId: session?.activeTenantId ?? memberships[0]?.tenantId ?? null,
    memberships,
  });
}

async function postHandler(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const name =
    body && typeof body === "object" && "name" in body
      ? (body as { name?: unknown }).name
      : undefined;
  const slug =
    body && typeof body === "object" && "slug" in body
      ? (body as { slug?: unknown }).slug
      : undefined;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (typeof slug !== "string" || slug.trim().length === 0) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  try {
    const tenant = await createTenant({
      name: name.trim(),
      slug: slug.trim(),
      ownerUserId: userId,
    });
    return NextResponse.json(
      {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        createdAt: tenant.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create tenant failed:", error);
    return NextResponse.json(
      { error: "create_failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(postHandler, { category: "tenants:write" });
