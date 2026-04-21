import { NextResponse, type NextRequest } from "next/server";
import { decryptJWE } from "@/lib/jwe/decrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import type { Session } from "@/lib/session/types";

// ---------------------------------------------------------------------------
// Shared markdown rewrite (originally in proxy.ts)
// ---------------------------------------------------------------------------

function wantsSharedMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  const accept = acceptHeader.toLowerCase();
  return accept.includes("text/markdown") || accept.includes("text/plain");
}

// ---------------------------------------------------------------------------
// Tenant auth gating (originally in middleware.ts)
// ---------------------------------------------------------------------------

/**
 * Paths that must remain reachable without a session — OAuth flows, webhook
 * endpoints (authenticated via signatures, not cookies), and anything callers
 * hit before logging in.
 */
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/github/webhook",
  "/api/vercel/webhook",
  "/api/sandbox/webhook",
  "/api/shared/",
  "/api/invite/",
  "/api/health",
  "/api/docs",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Tenant-scoped Personal Access Tokens use the `oa_pat_<base64url>` plaintext
 * format. Proxy runs in the Edge runtime and cannot hit Postgres, so PAT
 * lookup happens inside Node-runtime route handlers via
 * `requireTenantCtxFromBearer`. We only detect the header shape here.
 */
function hasPatBearer(req: NextRequest): boolean {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return false;
  const match = /^Bearer\s+(oa_pat_\S+)$/i.exec(header);
  return match !== null;
}

// ---------------------------------------------------------------------------
// Combined proxy handler
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Shared markdown rewrite ---
  if (pathname.startsWith("/shared/")) {
    if (request.method !== "GET") {
      return NextResponse.next();
    }
    const segments = pathname.split("/").filter(Boolean);
    if (
      segments.length === 2 &&
      segments[0] === "shared" &&
      wantsSharedMarkdown(request.headers.get("accept"))
    ) {
      const rewrittenUrl = request.nextUrl.clone();
      rewrittenUrl.pathname = `/api/shared/${segments[1]}/markdown`;
      return NextResponse.rewrite(rewrittenUrl);
    }
    return NextResponse.next();
  }

  // --- Tenant auth gating for /api/* ---
  if (!pathname.startsWith("/api/") || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    if (hasPatBearer(request)) {
      const requestHeaders = new Headers(request.headers);
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

  const requestHeaders = new Headers(request.headers);
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
// When custom domains are enabled, check Host header against verified custom
// domains in the /api/* path above. See middleware.ts comments for full spec.
// ---------------------------------------------------------------------------

export const config = {
  matcher: ["/api/:path*", "/shared/:path*"],
};
