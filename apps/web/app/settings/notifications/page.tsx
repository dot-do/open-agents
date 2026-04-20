"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetcher } from "@/lib/swr";

type Preference = {
  event: string;
  label: string;
  channel: "email" | "none";
};

type PreferencesResponse = {
  preferences: Preference[];
};

export default function NotificationsPage() {
  const { data, mutate } = useSWR<PreferencesResponse>(
    "/api/tenant/notification-preferences",
    fetcher,
  );

  const toggle = useCallback(
    async (event: string, currentChannel: string) => {
      const newChannel = currentChannel === "email" ? "none" : "email";

      // Optimistic update
      if (data) {
        mutate(
          {
            preferences: data.preferences.map((p) =>
              p.event === event ? { ...p, channel: newChannel } : p,
            ),
          },
          false,
        );
      }

      try {
        const res = await fetch("/api/tenant/notification-preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, channel: newChannel }),
        });
        if (!res.ok) {
          // Revert on failure
          await mutate();
        }
      } catch {
        await mutate();
      }
    },
    [data, mutate],
  );

  if (!data) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="text-sm text-muted-foreground">
        Choose which events send you email notifications for this workspace.
      </p>

      <div className="mt-4 space-y-1 rounded-md border border-border">
        {data.preferences.map((pref, i) => (
          <div
            key={pref.event}
            className={`flex items-center justify-between px-4 py-3 ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <Label
              htmlFor={`notif-${pref.event}`}
              className="cursor-pointer text-sm"
            >
              {pref.label}
            </Label>
            <Switch
              id={`notif-${pref.event}`}
              checked={pref.channel === "email"}
              onCheckedChange={() => toggle(pref.event, pref.channel)}
            />
          </div>
        ))}
      </div>
    </>
  );
}
