"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const KNOWN_EVENTS = [
  "session.created",
  "session.killed",
  "billing.plan_changed",
  "member.joined",
] as const;
type EventName = (typeof KNOWN_EVENTS)[number];

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
};

type DeliveryRow = {
  id: string;
  webhookId: string;
  event: string;
  status: "pending" | "success" | "failed" | "dead";
  attempts: number;
  responseStatus: number | null;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusBadge(
  status: DeliveryRow["status"],
): { label: string; cls: string } {
  switch (status) {
    case "success":
      return {
        label: "success",
        cls: "bg-emerald-500/10 text-emerald-600",
      };
    case "pending":
      return {
        label: "pending",
        cls: "bg-amber-500/10 text-amber-600",
      };
    case "failed":
      return {
        label: "failed",
        cls: "bg-orange-500/10 text-orange-600",
      };
    case "dead":
      return {
        label: "dead",
        cls: "bg-destructive/10 text-destructive",
      };
  }
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookRow[] | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<EventName[]>([
    "session.created",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/tenant/webhooks?include=deliveries",
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(
          (await res.json().catch(() => null))?.error ?? "Failed to load",
        );
      }
      const data = await res.json();
      setWebhooks(data.webhooks ?? []);
      setDeliveries(data.deliveries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/tenant/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: selectedEvents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create webhook");
      }
      const data = (await res.json()) as { secret: string };
      setRevealedSecret(data.secret);
      setUrl("");
      setSelectedEvents(["session.created"]);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [url, selectedEvents, load]);

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this webhook? Pending deliveries will be canceled.")) {
        return;
      }
      const res = await fetch(`/api/tenant/webhooks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Failed to delete");
        return;
      }
      await load();
    },
    [load],
  );

  const onToggleEvent = useCallback((ev: EventName) => {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setRevealedSecret(null);
    setSubmitError(null);
  }, []);

  const copySecret = useCallback(() => {
    if (!revealedSecret) return;
    void navigator.clipboard?.writeText(revealedSecret);
  }, [revealedSecret]);

  const webhookUrlById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of webhooks ?? []) m.set(w.id, w.url);
    return m;
  }, [webhooks]);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscribe to tenant events. Each delivery is HMAC-signed with your
            shared secret. Failed deliveries retry with exponential backoff
            (1m, 5m, 30m, 2h, 12h) before being marked dead.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(o) => {
            if (!o) closeDialog();
            else setDialogOpen(true);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {revealedSecret ? "Webhook created" : "Add webhook"}
              </DialogTitle>
              <DialogDescription>
                {revealedSecret
                  ? "Copy your signing secret now. You won't be able to view it again."
                  : "We'll generate a signing secret for you and show it once."}
              </DialogDescription>
            </DialogHeader>
            {revealedSecret ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Signing secret</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={revealedSecret}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={copySecret}
                      aria-label="Copy secret"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use this secret to verify the{" "}
                    <code className="font-mono">X-OA-Signature</code> header
                    (sha256 HMAC of the raw request body).
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="url">Endpoint URL</Label>
                  <Input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/hooks/openagents"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Events</Label>
                  <div className="flex flex-col gap-2">
                    {KNOWN_EVENTS.map((ev) => {
                      const checked = selectedEvents.includes(ev);
                      return (
                        <label
                          key={ev}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleEvent(ev)}
                            className="h-4 w-4"
                          />
                          <code className="font-mono text-xs">{ev}</code>
                        </label>
                      );
                    })}
                  </div>
                </div>
                {submitError ? (
                  <p className="text-sm text-destructive">{submitError}</p>
                ) : null}
              </div>
            )}
            <DialogFooter>
              {revealedSecret ? (
                <Button onClick={closeDialog}>Done</Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={closeDialog}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={onSubmit}
                    disabled={
                      submitting ||
                      !url.trim() ||
                      selectedEvents.length === 0
                    }
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Create webhook
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading webhooks…
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : !webhooks || webhooks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Webhook className="h-8 w-8 opacity-50" />
            No webhooks yet. Add one to receive event notifications.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last delivery</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="max-w-[280px] truncate font-mono text-xs">
                    {w.url}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {w.events.join(", ")}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        w.enabled
                          ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600"
                          : "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {w.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {w.lastDeliveryAt ? (
                      <>
                        {ageOf(w.lastDeliveryAt)}
                        {typeof w.lastDeliveryStatus === "number" ? (
                          <span className="ml-2 font-mono">
                            ({w.lastDeliveryStatus})
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(w.id)}
                      aria-label="Delete webhook"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Recent deliveries</h2>
        <div className="rounded-md border border-border">
          {!deliveries || deliveries.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No deliveries yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => {
                  const badge = statusBadge(d.status);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">
                        {d.event}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">
                        {webhookUrlById.get(d.webhookId) ?? d.webhookId}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {d.responseStatus ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{d.attempts}</TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={formatDate(d.createdAt)}
                      >
                        {ageOf(d.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
