import "server-only";

import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  auditEvents,
  chatMessages,
  chats,
  githubInstallations,
  linkedAccounts,
  memberships,
  sessions,
  tenantApiKeys,
  tenantInvites,
  tenantQuotas,
  tenantSsoConfigs,
  tenantStripeCustomers,
  tenantUsageCounters,
  tenants,
  usageEvents,
  userPreferences,
  vercelProjectLinks,
  workflowRunSteps,
  workflowRuns,
} from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";

/**
 * GDPR-grade tenant export. Streams NDJSON of every tenant-scoped row with
 * `__table` tagging so downstream consumers can re-associate rows. Secrets
 * are redacted — `tenant_api_keys.encryptedKey` is stripped (only the hint
 * survives) and `tenant_stripe_customers` keeps the stripe_customer_id
 * (useful for reconciliation) but drops subscription detail that could leak
 * billing internals.
 *
 * Intentionally NOT streaming via cursor pagination — this is an
 * operator-invoked, owner-only endpoint and workspace sizes are bounded by
 * tenant quota. If export volumes grow we can revisit with pg cursors.
 */
export async function exportTenant(
  ctx: Pick<TenantContext, "tenantId">,
): Promise<Readable> {
  const tid = ctx.tenantId;

  async function* iter(): AsyncGenerator<string, void, unknown> {
    function line(table: string, row: Record<string, unknown>): string {
      return `${JSON.stringify({ __table: table, ...row })}\n`;
    }

    // 1. tenants
    const tenantRows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tid));
    for (const r of tenantRows) yield line("tenants", r);

    // 2. memberships
    for (const r of await db
      .select()
      .from(memberships)
      .where(eq(memberships.tenantId, tid)))
      yield line("memberships", r);

    // 3. sessions
    for (const r of await db
      .select()
      .from(sessions)
      .where(eq(sessions.tenantId, tid)))
      yield line("sessions", r);

    // 4. chats
    for (const r of await db
      .select()
      .from(chats)
      .where(eq(chats.tenantId, tid)))
      yield line("chats", r);

    // 5. chat_messages
    for (const r of await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.tenantId, tid)))
      yield line("chat_messages", r);

    // 6. workflow_runs
    for (const r of await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.tenantId, tid)))
      yield line("workflow_runs", r);

    // 7. workflow_run_steps
    for (const r of await db
      .select()
      .from(workflowRunSteps)
      .where(eq(workflowRunSteps.tenantId, tid)))
      yield line("workflow_run_steps", r);

    // 8. github_installations
    for (const r of await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.tenantId, tid)))
      yield line("github_installations", r);

    // 9. vercel_project_links
    for (const r of await db
      .select()
      .from(vercelProjectLinks)
      .where(eq(vercelProjectLinks.tenantId, tid)))
      yield line("vercel_project_links", r);

    // 10. linked_accounts
    for (const r of await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.tenantId, tid)))
      yield line("linked_accounts", r);

    // 11. user_preferences
    for (const r of await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.tenantId, tid)))
      yield line("user_preferences", r);

    // 12. usage_events
    for (const r of await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.tenantId, tid)))
      yield line("usage_events", r);

    // 13. audit_events
    for (const r of await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tid)))
      yield line("audit_events", r);

    // 14. tenant_api_keys — REDACT encryptedKey (ciphertext never leaves).
    for (const r of await db
      .select()
      .from(tenantApiKeys)
      .where(eq(tenantApiKeys.tenantId, tid))) {
      const { encryptedKey: _omit, ...rest } = r;
      yield line("tenant_api_keys", { ...rest, encryptedKey: null });
    }

    // 15. tenant_quotas
    for (const r of await db
      .select()
      .from(tenantQuotas)
      .where(eq(tenantQuotas.tenantId, tid)))
      yield line("tenant_quotas", r);

    // 16. tenant_usage_counters
    for (const r of await db
      .select()
      .from(tenantUsageCounters)
      .where(eq(tenantUsageCounters.tenantId, tid)))
      yield line("tenant_usage_counters", r);

    // 17. tenant_stripe_customers — only stripe_customer_id, no subscription
    // detail which could leak billing internals or webhook secrets.
    for (const r of await db
      .select({
        tenantId: tenantStripeCustomers.tenantId,
        stripeCustomerId: tenantStripeCustomers.stripeCustomerId,
      })
      .from(tenantStripeCustomers)
      .where(eq(tenantStripeCustomers.tenantId, tid)))
      yield line("tenant_stripe_customers", r);

    // 18. tenant_invites
    for (const r of await db
      .select()
      .from(tenantInvites)
      .where(eq(tenantInvites.tenantId, tid)))
      yield line("tenant_invites", r);

    // 19. tenant_sso_configs — metadata may contain connection secrets;
    // redact to boolean presence only.
    for (const r of await db
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, tid))) {
      const { metadata, ...rest } = r;
      yield line("tenant_sso_configs", {
        ...rest,
        metadata: metadata ? { __redacted: true } : null,
      });
    }
  }

  return Readable.from(iter());
}
