import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "./constants";
import type { Session } from "./types";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Build the `Set-Cookie` header value for the session cookie. Shared between
 * the OAuth callbacks and the tenant-switcher route so the cookie attributes
 * (Max-Age, SameSite, HttpOnly, Secure) stay in lockstep.
 */
export async function buildSessionSetCookie(
  session: Session,
  opts?: { maxAgeSeconds?: number },
): Promise<string> {
  const maxAge = opts?.maxAgeSeconds ?? ONE_YEAR_SECONDS;
  const token = await encryptJWE(session, `${maxAge}s`);
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; ${secure}SameSite=Lax`;
}
