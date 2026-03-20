import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getOrCreateLocalAgentAuthUser,
  getUserById,
  LOCAL_AGENT_AUTH_USER_ID,
} from "@/lib/db/users";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import type { Session } from "@/lib/session/types";

const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_REDIRECT_PATH = "/sessions";

export const dynamic = "force-dynamic";

function resolveRedirectPath(nextPath: string | null): string {
  if (!nextPath) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return DEFAULT_REDIRECT_PATH;
}

function validateCode(
  providedCode: string | null,
  expectedCode: string,
): boolean {
  if (!providedCode) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedCode);
  const providedBuffer = Buffer.from(providedCode);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(req: Request): Promise<Response> {
  if (process.env.AGENT_WEB_AUTH_ENABLED !== "true") {
    return new Response("Not found", { status: 404 });
  }

  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const expectedCode = process.env.AGENT_WEB_AUTH_CODE;
  const agentUserId = process.env.AGENT_WEB_AUTH_USER_ID;

  if (!expectedCode || !agentUserId) {
    return Response.json(
      {
        error:
          "Agent auth is misconfigured. Set AGENT_WEB_AUTH_CODE and AGENT_WEB_AUTH_USER_ID.",
      },
      { status: 500 },
    );
  }

  const requestUrl = new URL(req.url);
  const providedCode = requestUrl.searchParams.get("code");
  if (!validateCode(providedCode, expectedCode)) {
    return Response.json({ error: "Invalid agent auth code" }, { status: 401 });
  }

  const user =
    agentUserId === LOCAL_AGENT_AUTH_USER_ID &&
    process.env.NODE_ENV !== "production"
      ? await getOrCreateLocalAgentAuthUser()
      : await getUserById(agentUserId);
  if (!user) {
    return Response.json(
      { error: "Configured agent user was not found" },
      { status: 500 },
    );
  }

  const session: Session = {
    created: Date.now(),
    authProvider: user.provider,
    user: {
      id: user.id,
      username: user.username,
      email: user.email ?? undefined,
      name: user.name ?? user.username,
      avatar: user.avatarUrl ?? "",
    },
  };

  const sessionToken = await encryptJWE(session, "1y");
  const redirectPath = resolveRedirectPath(requestUrl.searchParams.get("next"));

  const response = NextResponse.redirect(
    new URL(redirectPath, requestUrl.origin),
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  response.headers.set("Cache-Control", "no-store");

  return response;
}
