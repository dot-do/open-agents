import "server-only";

import { dispatchPending } from "@/lib/webhooks";

/**
 * Outbound webhook dispatcher (issue open-agents-uom).
 *
 * Ops runbook:
 *   - Trigger via Vercel Cron (or any external cron). Recommended cadence:
 *     every minute (`* * * * *`). Each invocation picks up to 50 pending
 *     deliveries; oversize backlogs drain over multiple ticks.
 *   - Authentication: set `CRON_SECRET` and wire callers to send
 *       `Authorization: Bearer $CRON_SECRET`. When unset this route is
 *       callable by anyone with network access — safe behind a Vercel Cron
 *       schedule but NOT safe to expose publicly.
 *   - Retry policy lives in `lib/webhooks.ts#BACKOFF_SCHEDULE_MS`
 *     (1m, 5m, 30m, 2h, 12h). After 5 attempts a delivery is marked `dead`.
 *
 * To enable in Vercel, add the following to `vercel.json` at the repo root
 * (or apps/web depending on your project structure):
 *
 *   {
 *     "crons": [
 *       { "path": "/api/cron/webhook-dispatch", "schedule": "* * * * *" }
 *     ]
 *   }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev convenience — see runbook above
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchPending({ batchSize: 50 });
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}
