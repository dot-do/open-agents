import { ensureLinkedAccountForUser } from "@/lib/db/linked-accounts";
import { getServerSession } from "@/lib/session/get-server-session";
import { parseSlackLinkToken } from "@/lib/slack/link-token";

export const runtime = "nodejs";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlPage(title: string, message: string, status = 200): Response {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #0b0b0c; color: #f5f5f5; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { max-width: 480px; width: 100%; border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 24px; background: rgba(255,255,255,.04); }
      h1 { font-size: 24px; margin: 0 0 12px; }
      p { margin: 0; line-height: 1.5; color: rgba(255,255,255,.8); }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${safeTitle}</h1>
        <p>${safeMessage}</p>
      </section>
    </main>
  </body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token) {
    return htmlPage("Invalid Slack link", "Missing link token.", 400);
  }

  const session = await getServerSession();
  if (!session?.user) {
    const signInUrl = new URL("/api/auth/signin/vercel", request.url);
    signInUrl.searchParams.set(
      "next",
      `/api/slack/link?token=${encodeURIComponent(token)}`,
    );
    return Response.redirect(signInUrl);
  }

  const payload = await parseSlackLinkToken(token);
  if (!payload) {
    return htmlPage(
      "Invalid Slack link",
      "This Slack link is invalid or expired. Return to Slack and try again.",
      400,
    );
  }

  const result = await ensureLinkedAccountForUser({
    userId: session.user.id,
    provider: "slack",
    externalId: payload.externalId,
    workspaceId: payload.workspaceId,
    metadata: {
      linkedVia: "slack",
    },
  });

  if (result.status === "conflict") {
    return htmlPage(
      "Slack account already linked",
      "This Slack account is already linked to another Open Harness account.",
      409,
    );
  }

  return htmlPage(
    "Slack account linked",
    "Your Slack account is now linked to Open Harness. Go back to Slack and try again.",
  );
}
