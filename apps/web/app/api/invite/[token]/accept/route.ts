import { NextResponse, type NextRequest } from "next/server";
import { acceptInvite } from "@/lib/invites";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import { getSessionFromReq } from "@/lib/session/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { token } = await params;
  try {
    const result = await acceptInvite({ token, userId });
    // Flip the session's active tenant to the newly-joined one so the user
    // lands in the right workspace after the redirect.
    const response = NextResponse.json({
      ok: true,
      tenantId: result.tenantId,
      tenantSlug: result.tenantSlug,
      role: result.role,
      emailMismatch: result.emailMismatch,
    });
    response.headers.append(
      "Set-Cookie",
      await buildSessionSetCookie({
        ...session,
        activeTenantId: result.tenantId,
        role: result.role,
      }),
    );
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
