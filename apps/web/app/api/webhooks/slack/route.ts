import { after } from "next/server";
import { getSlackBot, isSlackConfigured } from "@/lib/slack/bot";
import { runWithSlackRequestContext } from "@/lib/slack/request-context";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSlackConfigured()) {
    return Response.json(
      { error: "Slack integration is not configured" },
      { status: 503 },
    );
  }

  const baseUrl = new URL(request.url).origin;

  return runWithSlackRequestContext({ baseUrl }, () =>
    getSlackBot().webhooks.slack(request, {
      waitUntil: (task) => after(() => task),
    }),
  );
}
