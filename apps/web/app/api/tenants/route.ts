import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listMembershipsForUser } from "@/lib/db/memberships";
import { withRateLimit } from "@/lib/rate-limit";
import { getSessionFromReq } from "@/lib/session/server";
import { createTenant } from "@/lib/tenants";
import { validateBody } from "@/lib/validation";

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

const createTenantSchema = z.object({
  name: z.string().min(1, "name is required").max(100, "name must be at most 100 characters").transform((s) => s.trim()),
  slug: z.string().min(1, "slug is required").max(50, "slug must be at most 50 characters").regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "slug must be lowercase alphanumeric with dashes").transform((s) => s.trim()),
});

async function postHandler(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, response } = await validateBody(req, createTenantSchema);
  if (response) return response;

  try {
    const tenant = await createTenant({
      name: data.name,
      slug: data.slug,
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
