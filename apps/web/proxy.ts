import { NextResponse, type NextRequest } from "next/server";
import { decryptJWE } from "@/lib/jwe/decrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import type { Session } from "@/lib/session/types";

// ---------------------------------------------------------------------------
// In-memory IP-based rate limiter (Edge runtime compatible, no Redis)
// ---------------------------------------------------------------------------
// First-line brute-force defense for auth and PAT endpoints. The real
// tenant-scoped Redis-backed limiter (`withRateLimit`) handles per-route
// limits after auth resolves. This one runs BEFORE auth to cap raw IP
// request volume cheaply.

interface IpBucket {
  /** Timestamps (ms) of recent requests within the sliding window. */
  hits: number[];
}

const IP_BUCKETS = new Map<string, IpBucket>();
const WINDOW_MS = 60_000; // 1-minute sliding window

// Purge stale entries every 60s to prevent unbounded memory growth.
let lastCleanup = Date.now();
function cleanupStaleBuckets(): void {
  const now = Date.now();
  if (now - lastCleanup < WINDOW_MS) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;
  for (const [ip, bucket] of IP_BUCKETS) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) IP_BUCKETS.delete(ip);
  }
}

/**
 * Returns a 429 Response if the IP exceeds `maxRequests` in the current
 * 1-minute window, or `null` if the request is allowed.
 */
function checkIpRateLimit(
  ip: string,
  maxRequests: number,
): Response | null {
  cleanupStaleBuckets();
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let bucket = IP_BUCKETS.get(ip);
  if (!bucket) {
    bucket = { hits: [] };
    IP_BUCKETS.set(ip, bucket);
  }

  // Trim expired entries for this bucket.
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= maxRequests) {
    const oldestInWindow = bucket.hits[0]!;
    const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return NextResponse.json(
      { error: "too_many_requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(retryAfter, 1)) },
      },
    );
  }

  bucket.hits.push(now);
  return null;
}

/** Limits for different pre-auth paths (requests per minute per IP). */
const AUTH_RATE_LIMIT = 20;
const PAT_RATE_LIMIT = 10;

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
// Tenant auth gating (merged from the former middleware into proxy.ts)
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

  // --- Inject request ID on every request (Edge-compatible) ---
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  // Helper: attach x-request-id to any response leaving the proxy.
  function withRequestId(response: NextResponse): NextResponse {
    response.headers.set("x-request-id", requestId);
    return response;
  }

  // Helper: build NextResponse.next() with requestId forwarded downstream.
  function nextWithId(
    opts?: { request?: { headers: Headers } },
  ): NextResponse {
    const headers = opts?.request?.headers ?? new Headers(request.headers);
    headers.set("x-request-id", requestId);
    return withRequestId(
      NextResponse.next({ request: { headers } }),
    );
  }

  // --- Shared markdown rewrite ---
  if (pathname.startsWith("/shared/")) {
    if (request.method !== "GET") {
      return nextWithId();
    }
    const segments = pathname.split("/").filter(Boolean);
    if (
      segments.length === 2 &&
      segments[0] === "shared" &&
      wantsSharedMarkdown(request.headers.get("accept"))
    ) {
      const rewrittenUrl = request.nextUrl.clone();
      rewrittenUrl.pathname = `/api/shared/${segments[1]}/markdown`;
      const rewrite = NextResponse.rewrite(rewrittenUrl);
      rewrite.headers.set("x-request-id", requestId);
      return rewrite;
    }
    return nextWithId();
  }

  // --- Tenant auth gating for /api/* ---
  if (!pathname.startsWith("/api/") || isPublicApi(pathname)) {
    // Auth paths are public but still need IP rate limiting.
    if (pathname.startsWith("/api/auth/")) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const limited = checkIpRateLimit(`auth:${ip}`, AUTH_RATE_LIMIT);
      if (limited) return limited;
    }
    return nextWithId();
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    if (hasPatBearer(request)) {
      // IP rate limit PAT attempts — failed lookups are expensive (DB hit).
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const limited = checkIpRateLimit(`pat:${ip}`, PAT_RATE_LIMIT);
      if (limited) return limited;

      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-auth-via", "pat");
      return nextWithId({ request: { headers: requestHeaders } });
    }
    return withRequestId(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as NextResponse,
    );
  }

  const session = await decryptJWE<Session>(cookieValue);
  const userId = session?.user?.id;
  if (!session || !userId) {
    return withRequestId(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as NextResponse,
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", userId);
  if (session.activeTenantId) {
    requestHeaders.set("x-tenant-id", session.activeTenantId);
  }
  if (session.role) {
    requestHeaders.set("x-role", session.role);
  }

  return nextWithId({ request: { headers: requestHeaders } });
}

// ---------------------------------------------------------------------------
// Custom domain routing (not yet implemented — requires Vercel domain config)
// ---------------------------------------------------------------------------
// When custom domains are enabled, check Host header against verified custom
// domains in the /api/* path above. See the custom domains feature spec.
// ---------------------------------------------------------------------------

export const config = {
  matcher: ["/api/:path*", "/shared/:path*"],
};
