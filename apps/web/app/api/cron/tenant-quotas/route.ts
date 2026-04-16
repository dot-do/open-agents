import "server-only";

import { sweepTenantQuotas } from "@/lib/quotas";

/**
 * Scheduled quota sweep.
 *
 * Ops runbook:
 *   - Trigger via Vercel Cron, a Workflow schedule, or any external cron.
 *   - Recommended cadence: every 5 minutes. Each invocation is idempotent.
 *   - Authentication: set `CRON_SECRET` and wire callers to send
 *       `Authorization: Bearer $CRON_SECRET`. When unset this route is
 *       callable by anyone authenticated to the deployment network — safe
 *       behind a Vercel Cron schedule but NOT safe to expose publicly.
 *   - Emits structured logs on the console:
 *       - `tenant.cost.warning` (80% of daily cost ceiling)
 *       - `tenant.cost.halted` (100% — sandboxes killed when hardKillEnabled)
 *       - `tenant.minutes.halted` (monthly minutes exhausted)
 *       - `tenant.sandbox.killed` (per-sandbox termination records)
 *     Wire your log drain / alerting (Datadog, Grafana, etc.) to page on
 *     `*.halted` events and ticket on `*.warning`.
 */
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured = permissive (dev)
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reports = await sweepTenantQuotas();
  return Response.json({ ok: true, tenants: reports.length, reports });
}

export async function POST(req: Request) {
  return GET(req);
}
