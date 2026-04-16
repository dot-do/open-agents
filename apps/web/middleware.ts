import { NextResponse, type NextRequest } from "next/server";
import { decryptJWE } from "@/lib/jwe/decrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import type { Session } from "@/lib/session/types";

/**
 * Paths that must remain reachable without a session — OAuth flows, webhook
 * endpoints (authenticated via signatures, not cookies), and anything callers
 * hit before logging in.
 *
 * Keep in sync with the tenant-wave guardrail: sandbox/github-app/webhook
 * routes are owned by other agents and must not be gated here.
 */
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/github/webhook",
  "/api/vercel/webhook",
  "/api/sandbox/webhook",
  "/api/shared/",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/") || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await decryptJWE<Session>(cookieValue);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", userId);
  if (session.activeTenantId) {
    requestHeaders.set("x-tenant-id", session.activeTenantId);
  }
  if (session.role) {
    requestHeaders.set("x-role", session.role);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Only run on /api/*. Static assets, app pages, and OAuth redirects bypass
  // the matcher entirely.
  matcher: ["/api/:path*"],
};
