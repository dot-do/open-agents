"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";

type Plan = "free" | "pro" | "team" | "enterprise";

interface Summary {
  plan: Plan;
  planMatrix: {
    concurrent_sandboxes: number | "custom";
    byo_keys: boolean;
    sso: boolean;
  };
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  usage: {
    monthSandboxMinutes: number;
    monthCostCents: number;
    dayCostCents: number;
  };
}

const fetcher = async (url: string): Promise<Summary> => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load billing summary (${res.status})`);
  return (await res.json()) as Summary;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPeriodEnd(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function BillingSection() {
  const { data, error, isLoading, mutate } = useSWR<Summary>(
    "/api/billing/summary",
    fetcher,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function startCheckout(plan: "pro" | "team") {
    setBusy(`checkout-${plan}`);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        credentials: "include",
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `Checkout failed (${res.status})`);
      }
      window.location.href = body.url;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? `Portal failed (${res.status})`);
      }
      window.location.href = body.url;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="mt-6 text-sm text-muted-foreground">Loading billing…</div>
    );
  }
  if (error || !data) {
    return (
      <div className="mt-6 space-y-3">
        <div className="text-sm text-destructive">
          Failed to load billing summary.
        </div>
        <Button variant="outline" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  const planLabel = data.plan.charAt(0).toUpperCase() + data.plan.slice(1);
  const capacity =
    data.planMatrix.concurrent_sandboxes === "custom"
      ? "Custom"
      : String(data.planMatrix.concurrent_sandboxes);

  return (
    <div className="mt-6 space-y-8">
      {errorMessage ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Current plan
            </div>
            <div className="mt-1 text-2xl font-semibold">{planLabel}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {data.subscriptionStatus
                ? `Status: ${data.subscriptionStatus}`
                : "No active subscription"}
              {data.currentPeriodEnd
                ? ` · Renews ${formatPeriodEnd(data.currentPeriodEnd)}`
                : ""}
            </div>
          </div>
          <div className="flex gap-2">
            {data.plan === "free" ? (
              <>
                <Button
                  onClick={() => startCheckout("pro")}
                  disabled={busy !== null}
                >
                  {busy === "checkout-pro" ? "Redirecting…" : "Upgrade to Pro"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => startCheckout("team")}
                  disabled={busy !== null}
                >
                  {busy === "checkout-team" ? "Redirecting…" : "Upgrade to Team"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={openPortal}
                disabled={busy !== null}
              >
                {busy === "portal" ? "Opening…" : "Manage billing"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <PlanStat label="Concurrent sandboxes" value={capacity} />
          <PlanStat
            label="Bring-your-own keys"
            value={data.planMatrix.byo_keys ? "Included" : "Not included"}
          />
          <PlanStat
            label="SSO"
            value={data.planMatrix.sso ? "Included" : "Not included"}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Usage this period
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <PlanStat
            label="Sandbox minutes (month)"
            value={data.usage.monthSandboxMinutes.toLocaleString()}
          />
          <PlanStat
            label="Cost (month)"
            value={formatCents(data.usage.monthCostCents)}
          />
          <PlanStat
            label="Cost (today)"
            value={formatCents(data.usage.dayCostCents)}
          />
        </div>
      </section>
    </div>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </div>
  );
}
