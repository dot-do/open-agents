"use client";

import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

type DeliveryRow = {
  id: string;
  tenantName: string;
  webhookUrl: string;
  event: string;
  status: "pending" | "success" | "failed" | "dead";
  responseStatus: number | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
};

type ListResponse = {
  deliveries: DeliveryRow[];
  nextCursor: string | null;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "dead", label: "Dead" },
] as const;

function statusBadge(status: DeliveryRow["status"]) {
  const styles: Record<DeliveryRow["status"], string> = {
    pending:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    success:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    dead: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function AdminWebhooksPage() {
  const [status, setStatus] = useState("all");
  const [tenant, setTenant] = useState("");
  const [event, setEvent] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const deferredTenant = useDeferredValue(tenant);
  const deferredEvent = useDeferredValue(event);

  const params = new URLSearchParams();
  params.set("limit", "50");
  if (status !== "all") params.set("status", status);
  if (deferredTenant) params.set("tenant", deferredTenant);
  if (deferredEvent) params.set("event", deferredEvent);
  if (cursor) params.set("before", cursor);

  const url = `/api/admin/webhooks?${params.toString()}`;
  const { data, isLoading, error } = useSWR<ListResponse>(url, fetcher, {
    keepPreviousData: true,
  });

  const rows = data?.deliveries ?? [];
  const nextCursor = data?.nextCursor ?? null;

  function resetPagination() {
    setCursor(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Webhook Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Cross-tenant webhook delivery log. Read-only.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Status
          </label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              resetPagination();
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Tenant
          </label>
          <Input
            type="search"
            placeholder="Search tenant name..."
            value={tenant}
            onChange={(e) => {
              setTenant(e.target.value);
              resetPagination();
            }}
          />
        </div>
        <div className="w-52">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Event type
          </label>
          <Input
            type="search"
            placeholder="e.g. session.completed"
            value={event}
            onChange={(e) => {
              setEvent(e.target.value);
              resetPagination();
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          Failed to load deliveries: {String(error)}
        </p>
      )}

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery ID</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Webhook URL</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">HTTP</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-muted-foreground"
                >
                  No deliveries found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">
                    {d.id.slice(0, 12)}...
                  </TableCell>
                  <TableCell className="text-sm">{d.tenantName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.webhookUrl}
                  </TableCell>
                  <TableCell className="text-sm">{d.event}</TableCell>
                  <TableCell>{statusBadge(d.status)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {d.responseStatus ?? "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {d.attempts}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(d.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {d.completedAt
                      ? new Date(d.completedAt).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!cursor}
          onClick={() => setCursor(null)}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          First page
        </button>
        <button
          type="button"
          disabled={!nextCursor}
          onClick={() => setCursor(nextCursor)}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Next page &rarr;
        </button>
      </div>
    </div>
  );
}
