import type { RateLimitResult } from "./rate-limit";

/**
 * Clone a Response and append X-RateLimit-* headers so clients can
 * self-throttle before hitting 429s.
 */
export function addRateLimitHeaders(
  res: Response,
  result: RateLimitResult,
): Response {
  const clone = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
  clone.headers.set("X-RateLimit-Limit", String(result.limit));
  clone.headers.set("X-RateLimit-Remaining", String(result.remaining));
  clone.headers.set(
    "X-RateLimit-Reset",
    String(Date.now() + result.resetMs),
  );
  return clone;
}
