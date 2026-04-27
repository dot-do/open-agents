import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit, withTenantTags } from "@/lib/audit";
import { getMembership } from "@/lib/db/memberships";
import { withRateLimit } from "@/lib/rate-limit";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import { getSessionFromReq } from "@/lib/session/server";
import type { Session } from "@/lib/session/types";
import { validateBody } from "@/lib/validation";

const switchSchema = z.object({
  tenantId: z.string().min(1, "tenantId is required").max(100),
});

async function postHandler(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, response: validationError } = await validateBody(req, switchSchema);
  if (validationError) return validationError;
  const { tenantId } = data;

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
