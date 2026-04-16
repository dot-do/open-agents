import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  memberships,
  tenantQuotaAlerts,
  tenants,
  users,
} from "@/lib/db/schema";
import { escapeHtml, sendEmail } from "@/lib/email";

export type QuotaAlertKind = "daily_cost" | "monthly_minutes";
export type QuotaAlertThreshold = 80 | 100;

/**
 * Build the period bucket key used as part of the idempotency unique key.
 * Daily counters bucket by UTC date; monthly counters bucket by UTC month.
 * Keep this in sync with `dayStart`/`monthStart` in `lib/quotas`.
 */
function periodKeyFor(kind: QuotaAlertKind, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (kind === "daily_cost") {
    const d = String(now.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}`;
}

function appUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

function formatUsage(kind: QuotaAlertKind, value: number): string {
  if (kind === "daily_cost") {
    const dollars = value / 100;
    return `$${dollars.toFixed(2)}`;
  }
  return `${value} minutes`;
}

function kindLabel(kind: QuotaAlertKind): string {
  return kind === "daily_cost" ? "daily cost" : "monthly sandbox minutes";
}

export type DispatchQuotaAlertResult = {
  /** True when this alert was newly recorded; false if already sent this period. */
  sent: boolean;
  /** Number of recipient emails attempted (0 when skipped). */
  recipients: number;
};

/**
 * Send a quota threshold alert email to all owners of `tenantId`, exactly
 * once per (tenant, kind, threshold, period) tuple.
 *
 * Idempotency is enforced at the database layer: we INSERT into
 * `tenant_quota_alerts` with `ON CONFLICT DO NOTHING` against the unique
 * index `(tenantId, kind, threshold, periodKey)`. If the insert returns
 * zero rows, the alert was already sent for this period and we exit
 * silently — this is what makes the cron sweep safe to run every 5
 * minutes without spamming owners.
 */
export async function dispatchQuotaAlert(
  tenantId: string,
  kind: QuotaAlertKind,
  threshold: QuotaAlertThreshold,
  current: number,
  limit: number,
): Promise<DispatchQuotaAlertResult> {
  const periodKey = periodKeyFor(kind);

  // Idempotency gate: only proceed if THIS process owns the alert row.
  // `ON CONFLICT DO NOTHING` returning the inserted id lets a single
  // SQL roundtrip both reserve and detect prior sends.
  const inserted = await db
    .insert(tenantQuotaAlerts)
    .values({
      id: nanoid(),
      tenantId,
      kind,
      threshold,
      periodKey,
    })
    .onConflictDoNothing({
      target: [
        tenantQuotaAlerts.tenantId,
        tenantQuotaAlerts.kind,
        tenantQuotaAlerts.threshold,
        tenantQuotaAlerts.periodKey,
      ],
    })
    .returning({ id: tenantQuotaAlerts.id });

  if (inserted.length === 0) {
    return { sent: false, recipients: 0 };
  }

  const [tenantRow] = await db
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const ownerRows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, "owner"),
        sql`${users.email} is not null`,
      ),
    );

  const recipients = ownerRows
    .map((r) => r.email)
    .filter((e): e is string => Boolean(e));

  if (recipients.length === 0) {
    // Idempotency row is already written; downgrading it would re-fire
    // next sweep. Log instead and consider this dispatched.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "quota.alert.no_owner",
        tenantId,
        kind,
        threshold,
        periodKey,
      }),
    );
    return { sent: true, recipients: 0 };
  }

  const tenantName = tenantRow?.name ?? "your team";
  const subject = `[Open Agents] ${tenantName} ${kind} at ${threshold}%`;
  const usage = formatUsage(kind, current);
  const cap = formatUsage(kind, limit);
  const billingUrl = `${appUrl()}/settings/billing`;
  const halted = threshold >= 100;
  const headline = halted
    ? `Your ${kindLabel(kind)} cap has been reached`
    : `Your ${kindLabel(kind)} usage is at ${threshold}% of the cap`;

  const text = [
    `${headline}.`,
    "",
    `Tenant: ${tenantName}`,
    `Usage: ${usage} of ${cap} (${threshold}%)`,
    halted
      ? "Sandboxes for this tenant may have been stopped to prevent further charges."
      : "No action is required — this is an early warning.",
    "",
    `Manage limits: ${billingUrl}`,
  ].join("\n");

  const html = `
    <p>${escapeHtml(headline)}.</p>
    <p><strong>Tenant:</strong> ${escapeHtml(tenantName)}<br />
    <strong>Usage:</strong> ${escapeHtml(usage)} of ${escapeHtml(cap)} (${threshold}%)</p>
    <p>${
      halted
        ? "Sandboxes for this tenant may have been stopped to prevent further charges."
        : "No action is required &mdash; this is an early warning."
    }</p>
    <p><a href="${billingUrl}">Manage limits in settings &rsaquo;</a></p>
  `.trim();

  // Fan out — sendEmail itself never throws, so a single bad recipient
  // address can't poison the rest.
  await Promise.all(
    recipients.map((to) =>
      sendEmail({ to, subject, html, text, event: "quota.alert.email" }),
    ),
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "quota.alert.sent",
      tenantId,
      kind,
      threshold,
      periodKey,
      recipients: recipients.length,
    }),
  );

  return { sent: true, recipients: recipients.length };
}
