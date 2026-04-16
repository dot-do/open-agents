import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
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
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { killTenantSandboxes } from "@/lib/quotas";
import { RbacError, requireRole } from "@/lib/rbac";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { sql } from "drizzle-orm";

/**
 * Hard-delete a tenant. Owner only, guarded by slug double-confirm in the
 * request body to prevent accidental deletion. Emits a structured
 * `tenant.deleted` log line with per-table counts for ops.
 *
 * Cascades: `tenants.id` is the parent FK for every tenant-scoped table
 * with ON DELETE CASCADE (see schema.ts wave-1 / wave-3A). The DELETE on
 * the parent row is sufficient — we do NOT add new cascades here.
 *
 * Last-owner caveat: a caller deleting a tenant is by definition the last
 * owner (or one of many). We intentionally do NOT block this — deleting
 * the tenant revokes everyone's access to the workspace, which is the
 * desired outcome. UI documents this.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const { tenantId } = await params;
    const ctx = await requireTenantCtx(req);
    if (ctx.tenantId !== tenantId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requireRole(ctx, "owner");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const confirmSlug =
      body && typeof body === "object" && "confirmSlug" in body
        ? (body as { confirmSlug?: unknown }).confirmSlug
        : undefined;
    if (typeof confirmSlug !== "string" || confirmSlug.length === 0) {
      return NextResponse.json(
        { error: "confirmSlug required" },
        { status: 400 },
      );
    }

    const [tenant] = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (confirmSlug !== tenant.slug) {
      return NextResponse.json(
        { error: "confirm_mismatch" },
        { status: 400 },
      );
    }

    // Snapshot per-table counts before delete — used by the structured log
    // line emitted after the cascade completes. These counts are
    // best-effort, not load-bearing; failures log but don't block.
    const counts = await computeCounts(tenantId);

    // Write the audit row BEFORE the cascade wipes the tenant's audit
    // table. This row is the tenant's own — it cascades away with the
    // tenant — so we also emit a stdout line so SRE has a record.
    await audit(ctx, "tenant.deleted", {
      target: tenantId,
      metadata: { slug: tenant.slug, counts },
    });

    // (a) Kill active sandboxes
    try {
      await killTenantSandboxes(tenantId, "tenant_deletion");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "tenant.delete.kill_failed",
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // (b) Archive Stripe customer — cancel active subscription, then
    // `customers.del`. Never blocks on Stripe failure.
    try {
      if (isStripeConfigured()) {
        const [row] = await db
          .select({
            stripeCustomerId: tenantStripeCustomers.stripeCustomerId,
            subscriptionId: tenantStripeCustomers.subscriptionId,
          })
          .from(tenantStripeCustomers)
          .where(eq(tenantStripeCustomers.tenantId, tenantId))
          .limit(1);
        if (row?.stripeCustomerId) {
          const stripe = getStripe();
          if (row.subscriptionId) {
            try {
              await stripe.subscriptions.cancel(row.subscriptionId);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn(
                JSON.stringify({
                  event: "tenant.delete.stripe_sub_cancel_failed",
                  tenantId,
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
            }
          }
          try {
            await stripe.customers.del(row.stripeCustomerId);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(
              JSON.stringify({
                event: "tenant.delete.stripe_customer_del_failed",
                tenantId,
                error: e instanceof Error ? e.message : String(e),
              }),
            );
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "tenant.delete.stripe_failed",
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // (c) Delete the parent tenant row — cascades wipe everything else.
    await db.delete(tenants).where(eq(tenants.id, tenantId));

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "tenant.deleted",
        tenantId,
        slug: tenant.slug,
        actorUserId: ctx.userId,
        counts,
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

async function computeCounts(
  tenantId: string,
): Promise<Record<string, number>> {
  const tables = [
    ["memberships", memberships],
    ["sessions", sessions],
    ["chats", chats],
    ["chat_messages", chatMessages],
    ["workflow_runs", workflowRuns],
    ["workflow_run_steps", workflowRunSteps],
    ["github_installations", githubInstallations],
    ["vercel_project_links", vercelProjectLinks],
    ["linked_accounts", linkedAccounts],
    ["user_preferences", userPreferences],
    ["usage_events", usageEvents],
    ["audit_events", auditEvents],
    ["tenant_api_keys", tenantApiKeys],
    ["tenant_quotas", tenantQuotas],
    ["tenant_usage_counters", tenantUsageCounters],
    ["tenant_stripe_customers", tenantStripeCustomers],
    ["tenant_invites", tenantInvites],
    ["tenant_sso_configs", tenantSsoConfigs],
  ] as const;
  const out: Record<string, number> = {};
  for (const [name, table] of tables) {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic table iteration
      const t = table as any;
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(t)
        .where(eq(t.tenantId, tenantId));
      out[name] = (rows[0]?.c as number | undefined) ?? 0;
    } catch {
      out[name] = -1;
    }
  }
  return out;
}
