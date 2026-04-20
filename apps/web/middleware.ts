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
  // Invite accept flow: the GET preview is public; the POST accept handler
  // performs its own session check so it can return a clean 401 rather than
  // the generic middleware 401. See /api/invite/[token]/route.ts.
  "/api/invite/",
  "/api/health",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Tenant-scoped Personal Access Tokens use the `oa_pat_<base64url>` plaintext
 * format. Middleware runs in the Edge runtime and cannot hit Postgres
 * (postgres-js is Node-only), so PAT lookup happens inside Node-runtime
 * route handlers via `requireTenantCtxFromBearer`. We only detect the header
 * shape here and let the request through; routes that opt into PAT auth
 * resolve and validate the token themselves. Routes that DON'T opt in still
 * see no session/userId/role headers and will reject the request.
 */
function hasPatBearer(req: NextRequest): boolean {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return false;
  const match = /^Bearer\s+(oa_pat_\S+)$/i.exec(header);
  return match !== null;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/") || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    if (hasPatBearer(req)) {
      // Defer to per-route bearer resolution. Mark the request so downstream
      // helpers can short-circuit cookie lookups without re-parsing headers.
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-auth-via", "pat");
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
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

// ---------------------------------------------------------------------------
// Custom domain routing (not yet implemented — requires Vercel domain config)
// ---------------------------------------------------------------------------
// When custom domains are enabled at the infrastructure level, the middleware
// would check the Host header against verified custom domains:
//
//   1. Extract `req.headers.get("host")` (strip port if present).
//   2. Skip if the host matches the primary app domain (e.g. *.open-agents.com).
//   3. Call `lookupTenantByDomain(host)` from `@/lib/custom-domains`.
//   4. If a tenantId is returned, set `x-tenant-id` on the request headers
//      so downstream `requireTenantCtx` resolves the correct tenant context
//      without requiring the user to have switched tenants in their session.
//   5. If no match, return 404 or redirect to the primary domain.
//
// This requires Vercel wildcard/custom domain configuration and cannot be
// implemented purely in application code. See the custom domains feature spec.
// ---------------------------------------------------------------------------

export const config = {
  // Only run on /api/*. Static assets, app pages, and OAuth redirects bypass
  // the matcher entirely.
  matcher: ["/api/:path*"],
};
