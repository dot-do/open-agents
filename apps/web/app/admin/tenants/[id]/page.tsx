"use client";

import Link from "next/link";
import { use, useCallback, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

type Member = {
  userId: string;
  role: string;
  email: string | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};
type RecentSession = {
  id: string;
  title: string;
  status: string;
  lifecycleState: string | null;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  lastActivityAt: string | null;
  createdAt: string;
};
type AuditRow = {
  id: string;
  actorUserId: string | null;
  action: string;
  target: string | null;
  metadata: unknown;
  createdAt: string;
};
type UsageDayPoint = {
  date: string;
  sandboxMinutes: number;
  costCents: number;
};
type UsageData = {
  daily: UsageDayPoint[];
  totals: { sandboxMinutes: number; costCents: number; days: number };
};

type TenantDetail = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  plan: {
    name: string;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
  };
  quotas: {
    maxConcurrentSandboxes: number;
    maxMonthlyMinutes: number;
    maxDailyCostCents: number;
    hardKillEnabled: boolean;
    maxDailySpendByProvider: Record<string, number> | null;
  };
  usage: {
    activeSandboxes: number;
    monthlyMinutes: number;
    dailyCostCents: number;
  };
  members: Member[];
  recentSessions: RecentSession[];
  recentAudit: AuditRow[];
};

export default function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, error, mutate } = useSWR<TenantDetail>(
    `/api/admin/tenants/${id}`,
    fetcher,
  );
  const [busy, setBusy] = useState<"kill" | "impersonate" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [killSummary, setKillSummary] = useState<string | null>(null);

  const onKill = async () => {
    if (
      !confirm(
        "Force-kill all live sandboxes for this tenant? This stops every active session.",
      )
    )
      return;
    setBusy("kill");
    setActionError(null);
    setKillSummary(null);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/kill-sandboxes`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "kill failed");
        return;
      }
      const stopped =
        (json.results as Array<{ stopped: boolean }> | undefined)?.filter(
          (r) => r.stopped,
        ).length ?? 0;
      const total = (json.results as unknown[] | undefined)?.length ?? 0;
      setKillSummary(`Killed ${stopped} of ${total} sandboxes.`);
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onImpersonate = async () => {
    if (
      !confirm(
        "Impersonate this tenant as a viewer? You will be redirected and your session will show an impersonation banner until you stop.",
      )
    )
      return;
    setBusy("impersonate");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/impersonate`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionError(json.error ?? "impersonate failed");
        return;
      }
      window.location.href = "/";
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (error || !data) {
    return (
      <div className="space-y-2">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <p className="text-sm text-destructive">
          Failed to load tenant: {String(error ?? "not found")}
        </p>
      </div>
    );
  }

  const { tenant, plan, quotas, usage, members, recentSessions, recentAudit } =
    data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{tenant.name}</h1>
            <p className="text-sm text-muted-foreground">
              {tenant.slug} · {plan.name}
              {plan.subscriptionStatus ? ` · ${plan.subscriptionStatus}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onImpersonate}
              disabled={busy !== null}
            >
              {busy === "impersonate" ? "Switching…" : "Impersonate"}
            </Button>
            <Button
              variant="destructive"
              onClick={onKill}
              disabled={busy !== null}
            >
              {busy === "kill" ? "Killing…" : "Kill sandboxes"}
            </Button>
          </div>
        </div>
        {actionError && (
          <p className="mt-2 text-sm text-destructive">{actionError}</p>
        )}
        {killSummary && (
          <p className="mt-2 text-sm text-muted-foreground">{killSummary}</p>
        )}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions ({recentSessions.length})
          </TabsTrigger>
          <TabsTrigger value="audit">Audit ({recentAudit.length})</TabsTrigger>
          <TabsTrigger value="quotas">Quotas</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Active sandboxes" value={usage.activeSandboxes} />
            <Stat label="Monthly minutes" value={usage.monthlyMinutes} />
            <Stat
              label="Today's cost"
              value={`$${(usage.dailyCostCents / 100).toFixed(2)}`}
            />
          </div>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row k="Tenant ID" v={tenant.id} mono />
            <Row k="Created" v={new Date(tenant.createdAt).toLocaleString()} />
            <Row k="Plan" v={plan.name} />
            <Row
              k="Renews"
              v={
                plan.currentPeriodEnd
                  ? new Date(plan.currentPeriodEnd).toLocaleDateString()
                  : "—"
              }
            />
          </dl>
        </TabsContent>

        <TabsContent value="members" className="pt-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">{m.name ?? m.username}</div>
                      <div className="text-xs text-muted-foreground">
                        @{m.username}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.email ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{m.role}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="pt-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead>Repo</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSessions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No sessions.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentSessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.title}</TableCell>
                      <TableCell className="text-sm">{s.status}</TableCell>
                      <TableCell className="text-sm">
                        {s.lifecycleState ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.repoOwner && s.repoName
                          ? `${s.repoOwner}/${s.repoName}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.lastActivityAt
                          ? new Date(s.lastActivityAt).toLocaleString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAudit.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No audit events.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentAudit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">
                        {a.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.actorUserId ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.target ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="quotas" className="pt-4">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row
              k="Max concurrent sandboxes"
              v={String(quotas.maxConcurrentSandboxes)}
            />
            <Row
              k="Max monthly minutes"
              v={String(quotas.maxMonthlyMinutes)}
            />
            <Row
              k="Max daily cost (cents)"
              v={String(quotas.maxDailyCostCents)}
            />
            <Row
              k="Hard kill enabled"
              v={quotas.hardKillEnabled ? "yes" : "no"}
            />
            <Row
              k="Per-provider caps"
              v={
                quotas.maxDailySpendByProvider
                  ? JSON.stringify(quotas.maxDailySpendByProvider)
                  : "—"
              }
              mono
            />
          </dl>
        </TabsContent>

        <TabsContent value="usage" className="pt-4">
          <UsageTab tenantId={id} tenantSlug={tenant.slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{v}</dd>
    </div>
  );
}

function UsageTab({
  tenantId,
  tenantSlug,
}: {
  tenantId: string;
  tenantSlug: string;
}) {
  const { data, isLoading, error } = useSWR<UsageData>(
    `/api/admin/tenants/${tenantId}/usage`,
    fetcher,
  );
  const [exporting, setExporting] = useState(false);

  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/admin/tenants/${tenantId}/export-usage?format=csv`,
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tenant-usage-${tenantSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [tenantId, tenantSlug]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading usage...</p>;
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        Failed to load usage data.
      </p>
    );
  }

  const { daily, totals } = data;

  return (
    <div className="space-y-6">
      {/* Period stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total minutes (30d)" value={totals.sandboxMinutes} />
        <Stat
          label="Total cost (30d)"
          value={`$${(totals.costCents / 100).toFixed(2)}`}
        />
        <Stat label="Days with data" value={totals.days} />
      </div>

      {/* Bar chart */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Daily sandbox minutes — last 30 days
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
        <UsageBarChart points={daily} />
      </div>
    </div>
  );
}

function UsageBarChart({ points }: { points: UsageDayPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No usage recorded in the last 30 days.
      </div>
    );
  }

  const maxMinutes = Math.max(1, ...points.map((p) => p.sandboxMinutes));
  const chartHeight = 96;

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${points.length * 12} ${chartHeight}`}
        className="w-full"
        preserveAspectRatio="none"
        aria-label="Usage bar chart"
      >
        {points.map((p, i) => {
          const h = Math.max(1, (p.sandboxMinutes / maxMinutes) * chartHeight);
          return (
            <rect
              key={p.date}
              x={i * 12 + 1}
              y={chartHeight - h}
              width={10}
              height={h}
              rx={2}
              className="fill-foreground/60 hover:fill-foreground"
            >
              <title>
                {p.date}: {p.sandboxMinutes} min, $
                {(p.costCents / 100).toFixed(2)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}
