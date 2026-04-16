import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { lookupTenantBySlug } from "@/lib/db/tenants";
import { listRecentWorkflowRunsForTenant } from "@/lib/db/workflow-runs";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${numberFormatter.format(Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSeconds.toString().padStart(2, "0")}s`;
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusClassName(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "aborted":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Tenant-scoped workflow runs view. Membership is enforced by the sibling
 * `apps/web/app/t/[tenantSlug]/layout.tsx`; this page resolves the tenant
 * row and lists the 50 most recent `workflow_runs` rows whose `tenant_id`
 * matches. Cross-tenant rows are filtered at the data layer in
 * `listRecentWorkflowRunsForTenant`.
 */
export default async function TenantWorkflowsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await lookupTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const runs = await listRecentWorkflowRunsForTenant(tenant.id, 50);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {tenant.name}
        </div>
        <h1 className="text-2xl font-semibold">Workflow runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The {runs.length === 50 ? "50 most recent" : `${runs.length}`}{" "}
          workflow runs for this tenant.
        </p>
      </header>

      {runs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No workflow runs yet for this tenant.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/sessions/${run.sessionId}`}
                      className="hover:underline"
                    >
                      {run.id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.modelId ?? "—"}
                  </TableCell>
                  <TableCell
                    className={`text-xs uppercase ${statusClassName(run.status)}`}
                  >
                    {run.status}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {numberFormatter.format(run.stepCount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(run.startedAt)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatDuration(run.totalDurationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
