import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { getDefaultMembershipForUser } from "@/lib/db/memberships";
import { upsertUser } from "@/lib/db/users";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import type { Session } from "@/lib/session/types";
import { createPersonalTenantForUser } from "@/lib/tenants";
import { exchangeVercelCode, getVercelUserInfo } from "@/lib/vercel/oauth";

function clearVercelOauthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("vercel_auth_state");
  store.delete("vercel_code_verifier");
  store.delete("vercel_auth_redirect_to");
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("vercel_auth_state")?.value;
  const codeVerifier = cookieStore.get("vercel_code_verifier")?.value;
  const rawRedirectTo =
    cookieStore.get("vercel_auth_redirect_to")?.value ?? "/";

  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/";

  if (!code || !state || storedState !== state || !codeVerifier) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response("Vercel OAuth not configured", { status: 500 });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/auth/vercel/callback`;

    const tokens = await exchangeVercelCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    });

    const userInfo = await getVercelUserInfo(tokens.access_token);

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const username =
      userInfo.preferred_username ?? userInfo.email ?? userInfo.sub;

    const userId = await upsertUser({
      provider: "vercel",
      externalId: userInfo.sub,
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      scope: tokens.scope,
      username,
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture,
      tokenExpiresAt,
    });

    let defaultMembership = await getDefaultMembershipForUser(userId);

    // New-user onboarding: users created after the wave-1 backfill may not
    // have a personal tenant yet. Create one lazily on first login so the
    // rest of the app (tenant-scoped queries) always has a membership.
    if (!defaultMembership) {
      try {
        await createPersonalTenantForUser({
          id: userId,
          username,
          name: userInfo.name,
        });
        defaultMembership = await getDefaultMembershipForUser(userId);
      } catch (error) {
        console.error("Personal tenant creation failed:", error);
      }
    }

    const session: Session = {
      created: Date.now(),
      authProvider: "vercel" as const,
      user: {
        id: userId,
        username,
        email: userInfo.email,
        name: userInfo.name ?? username,
        avatar: userInfo.picture ?? "",
      },
      activeTenantId: defaultMembership?.tenantId,
      role: defaultMembership?.role,
    };

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: storedRedirectTo,
      },
    });

    response.headers.append("Set-Cookie", await buildSessionSetCookie(session));

    clearVercelOauthCookies(cookieStore);

    return response;
  } catch (error) {
    console.error("Vercel OAuth callback error:", error);
    return new Response("Authentication failed", { status: 500 });
  }
}
