"use client";

import { useState } from "react";
import useSWR from "swr";
import type { SessionUserInfo } from "@/lib/session/types";
import { fetcher } from "@/lib/swr";

/**
 * Yellow banner rendered whenever the current session was minted by the
 * cross-tenant admin console (`/api/admin/tenants/[id]/impersonate`).
 * Clicking "Stop impersonating" hits `/api/admin/stop-impersonating`
 * which re-issues the cookie back to the original admin user.
 */
export function ImpersonationBanner() {
  const { data, mutate } = useSWR<SessionUserInfo>("/api/auth/info", fetcher);
  const [busy, setBusy] = useState(false);
  if (!data?.impersonatedBy) return null;

  const stop = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/stop-impersonating", {
        method: "POST",
      });
      if (res.ok) {
        await mutate();
        window.location.href = "/admin";
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-yellow-300 bg-yellow-100 px-4 py-2 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-100">
      <span>
        Impersonating tenant as a viewer. Original admin: {" "}
        <code className="font-mono text-xs">{data.impersonatedBy}</code>
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className="rounded-md border border-yellow-400 bg-yellow-200 px-2.5 py-1 text-xs font-medium hover:bg-yellow-300 disabled:opacity-60 dark:border-yellow-600 dark:bg-yellow-800 dark:hover:bg-yellow-700"
      >
        {busy ? "Stopping…" : "Stop impersonating"}
      </button>
    </div>
  );
}
