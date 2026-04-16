import { NextResponse, type NextRequest } from "next/server";
import { audit, withTenantTags } from "@/lib/audit";
import { getMembership } from "@/lib/db/memberships";
import { withRateLimit } from "@/lib/rate-limit";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import { getSessionFromReq } from "@/lib/session/server";
import type { Session } from "@/lib/session/types";

async function postHandler(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const tenantId =
    body && typeof body === "object" && "tenantId" in body
      ? (body as { tenantId?: unknown }).tenantId
      : undefined;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return NextResponse.json(
      { error: "tenantId required" },
      { status: 400 },
    );
  }

  const membership = await getMembership(userId, tenantId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const next: Session = {
    ...session,
    activeTenantId: tenantId,
    role: membership.role,
  };

  const response = NextResponse.json({
    ok: true,
    activeTenantId: tenantId,
    role: membership.role,
  });
  response.headers.append("Set-Cookie", await buildSessionSetCookie(next));

  const ctx = { tenantId, userId, role: membership.role };
  await withTenantTags(ctx, "tenant.switched", async () => {
    await audit(ctx, "tenant.switched", {
      target: tenantId,
      metadata: { previousTenantId: session.activeTenantId ?? null },
    });
  });

  return response;
}

export const POST = withRateLimit(postHandler, { category: "tenants:write" });
