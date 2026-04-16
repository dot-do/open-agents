import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { getDefaultMembershipForUser } from "@/lib/db/memberships";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getSessionFromCookie } from "@/lib/session/server";
import {
  getTenantUsageSummary,
  type TenantUsageSummary,
  type UsageDayPoint,
} from "@/lib/usage-summary";

export const dynamic = "force-dynamic";

async function resolveTenantForUser(): Promise<
  { tenantId: string; userId: string; role: "owner" | "admin" | "member" | "viewer" } | null
> {
  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(cookieValue);
  const userId = session?.user?.id;
  if (!userId) return null;

  const activeTenantId = session?.activeTenantId;
  if (activeTenantId) {
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.tenantId, activeTenantId),
        ),
      )
      .limit(1);
    if (row) {
      return {
        tenantId: activeTenantId,
        userId,
        role: row.role as "owner" | "admin" | "member" | "viewer",
      };
    }
  }
  const fallback = await getDefaultMembershipForUser(userId);
  if (!fallback) return null;
  return { tenantId: fallback.tenantId, userId, role: fallback.role };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function UsageMeter({
  label,
  used,
  cap,
  format,
}: {
  label: string;
  used: number;
  cap: number;
  format: (n: number) => string;
}) {
  const p = pct(used, cap);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {p}%
        </div>
      </div>
      <div className="mb-2 text-2xl font-semibold tabular-nums">
        {format(used)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          / {format(cap)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-foreground transition-all"
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

function Last30Chart({ points }: { points: UsageDayPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No usage recorded in the last 30 days.
      </div>
    );
  }
  const maxMinutes = Math.max(1, ...points.map((p) => p.sandboxMinutes));
  return (
    <div className="space-y-3">
      <div className="flex h-24 items-end gap-1">
        {points.map((p) => {
          const h = Math.max(2, Math.round((p.sandboxMinutes / maxMinutes) * 96));
          return (
            <div
              key={p.date}
              title={`${p.date}: ${p.sandboxMinutes} min, ${formatCents(p.costCents)}`}
              className="w-full flex-1 rounded-sm bg-foreground/60 hover:bg-foreground"
              style={{ height: `${h}px` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default async function UsageDashboardPage() {
  const ctx = await resolveTenantForUser();
  if (!ctx) redirect("/");
  const summary: TenantUsageSummary = await getTenantUsageSummary(ctx);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Current-period consumption for this tenant. Limits reset at the start
          of each period (month for minutes, day for cost).
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <UsageMeter
          label="Sandbox minutes (month)"
          used={summary.current.monthlyMinutes}
          cap={summary.quotas.maxMonthlyMinutes}
          format={(n) => `${n} min`}
        />
        <UsageMeter
          label="Cost (today)"
          used={summary.current.dailyCostCents}
          cap={summary.quotas.maxDailyCostCents}
          format={formatCents}
        />
        <UsageMeter
          label="Active sandboxes"
          used={summary.current.activeSandboxes}
          cap={summary.quotas.maxConcurrentSandboxes}
          format={(n) => String(n)}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Last 30 days — sandbox minutes
        </h2>
        <Last30Chart points={summary.last30Days} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Daily breakdown
        </h2>
        {summary.last30Days.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data.</div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Minutes</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.last30Days
                  .slice()
                  .reverse()
                  .map((p) => (
                    <tr key={p.date}>
                      <td className="px-3 py-2 tabular-nums">{p.date}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.sandboxMinutes}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCents(p.costCents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
