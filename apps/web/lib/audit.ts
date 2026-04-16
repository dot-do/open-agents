import "server-only";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { nanoid } from "nanoid";
import { auditEvents } from "@/lib/db/schema";
import { scopedQuery } from "@/lib/db/tenant-guard";
import type { TenantContext } from "@/lib/db/tenant-context";

/**
 * Standard audit action namespaces. New namespaces added here should be
 * dotted `domain.verb_past_tense`. Audit rows are append-only; the schema
 * lives at `audit_events` (see `apps/web/lib/db/schema.ts`).
 */
export type AuditAction =
  | "session.created"
  | "session.killed"
  | "installation.added"
  | "installation.removed"
  | "apikey.created"
  | "apikey.rotated"
  | "apikey.revoked"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "member.role_changed"
  | "quota.halted"
  | "tenant.created"
  | "tenant.switched"
  | "billing.plan_changed";

export interface AuditOptions {
  target?: string;
  metadata?: unknown;
}

/**
 * Append an audit event for the caller's tenant. Swallows and logs errors so
 * an audit write failure never fails the caller. Writes go through
 * `scopedQuery` so the `tenant_id` is always stamped from the `TenantContext`
 * — callers cannot spoof another tenant's audit row.
 */
export async function audit(
  ctx: { tenantId: string; userId?: string | null },
  action: AuditAction | (string & {}),
  opts?: AuditOptions,
): Promise<void> {
  try {
    const metadata =
      opts?.metadata === undefined
        ? undefined
        : isRecord(opts.metadata)
          ? (opts.metadata as Record<string, unknown>)
          : { value: opts.metadata };
    const q = scopedQuery({ tenantId: ctx.tenantId });
    await q.insertInto(auditEvents, {
      id: nanoid(),
      actorUserId: ctx.userId ? ctx.userId : null,
      action,
      target: opts?.target ?? null,
      metadata: metadata ?? null,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "audit.write_failed",
        tenantId: ctx.tenantId,
        action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Tenant-tagged telemetry helper. Wraps a function and emits structured
 * log entries stamped with `tenant_id`, `user_id`, and `role` at start/end.
 * When OpenTelemetry is wired up later, this is the single place to add
 * real spans — callers don't need to change.
 *
 * Signature: `withTenantTags(ctx, spanName, fn) => Promise<ReturnType<fn>>`
 */
export async function withTenantTags<T>(
  ctx: {
    tenantId: string;
    userId?: string | null;
    role?: TenantContext["role"] | null;
  },
  spanName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const tags = {
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    role: ctx.role,
  };
  // When no SDK has registered a TracerProvider, the global provider is the
  // noop implementation. In that case we emit the legacy JSON log line so
  // dev/self-hosted setups without OTLP configured keep the current behavior.
  // When a real provider is wired up (see `apps/web/instrumentation.ts`) the
  // span carries the attributes and we skip the log to avoid double-emitting.
  const providerName = trace.getTracerProvider().constructor.name;
  const tracingActive =
    providerName !== "NoopTracerProvider" &&
    providerName !== "ProxyTracerProvider"
      ? true
      : // ProxyTracerProvider forwards to whatever has been registered — if it
        // still points at the noop delegate, treat tracing as inactive.
        providerName === "ProxyTracerProvider"
        ? (trace.getTracerProvider() as { getDelegate?: () => unknown })
            .getDelegate?.()?.constructor.name !== "NoopTracerProvider"
        : false;

  const tracer = trace.getTracer("open-agents");
  return tracer.startActiveSpan(spanName, async (span) => {
    span.setAttribute("tenant.id", ctx.tenantId);
    if (ctx.userId) span.setAttribute("user.id", ctx.userId);
    if (ctx.role) span.setAttribute("tenant.role", ctx.role);
    try {
      const result = await fn();
      if (!tracingActive) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            event: "span.end",
            span: spanName,
            durationMs: Date.now() - start,
            ok: true,
            ...tags,
          }),
        );
      }
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      if (!tracingActive) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "span.end",
            span: spanName,
            durationMs: Date.now() - start,
            ok: false,
            error: err.message,
            ...tags,
          }),
        );
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
