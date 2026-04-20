"use client";

import {
  CreditCard,
  Key,
  Monitor,
  RefreshCw,
  Terminal,
  User,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ActivityEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorName: string | null;
  actorUsername: string | null;
  actorAvatarUrl: string | null;
}

interface ActivityFeedClientProps {
  tenantSlug: string;
  initialEvents: ActivityEvent[];
}

const ACTION_LABELS: Record<string, string> = {
  "session.created": "created a session",
  "session.killed": "ended a session",
  "installation.added": "added a GitHub installation",
  "installation.removed": "removed a GitHub installation",
  "apikey.created": "created an API key",
  "apikey.rotated": "rotated an API key",
  "apikey.revoked": "revoked an API key",
  "member.invited": "invited a member",
  "member.joined": "joined the workspace",
  "member.removed": "removed a member",
  "member.role_changed": "changed a member role",
  "quota.halted": "hit a quota limit",
  "tenant.created": "created the workspace",
  "tenant.switched": "switched workspace",
  "billing.plan_changed": "changed the billing plan",
};

function getActionIcon(action: string) {
  const namespace = action.split(".")[0];
  switch (namespace) {
    case "session":
      return <Terminal className="h-4 w-4" />;
    case "member":
      return <Users className="h-4 w-4" />;
    case "installation":
      return <Monitor className="h-4 w-4" />;
    case "billing":
      return <CreditCard className="h-4 w-4" />;
    case "apikey":
      return <Key className="h-4 w-4" />;
    case "tenant":
      return <Users className="h-4 w-4" />;
    default:
      return <User className="h-4 w-4" />;
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function ActivityFeedClient({
  tenantSlug,
  initialEvents,
}: ActivityFeedClientProps) {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/activity?limit=50");
      if (!res.ok) return;
      const data = (await res.json()) as { events: ActivityEvent[] };
      setEvents(data.events);
    } catch {
      // Silently ignore refresh failures.
    }
  }, []);

  // Auto-refresh every 30 seconds.
  useEffect(() => {
    const interval = setInterval(fetchEvents, 30_000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEvents();
    setRefreshing(false);
  }, [fetchEvents]);

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <RefreshCw
            className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />

        <ul className="space-y-0">
          {events.map((event) => {
            const actorDisplay =
              event.actorName || event.actorUsername || "System";
            const actionLabel =
              ACTION_LABELS[event.action] ?? event.action.replace(".", " ");

            return (
              <li key={event.id} className="relative flex gap-3 pb-4">
                {/* Icon dot */}
                <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                  {getActionIcon(event.action)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">
                      {actorDisplay}
                    </span>{" "}
                    <span className="text-muted-foreground">{actionLabel}</span>
                    {event.target ? (
                      <>
                        {" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {event.target}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p
                    className="text-xs text-muted-foreground"
                    title={formatAbsoluteTime(event.createdAt)}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </p>
                  {event.metadata &&
                    Object.keys(event.metadata).length > 0 && (
                      <pre className="mt-1 max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        {JSON.stringify(event.metadata, null, 2).slice(0, 200)}
                      </pre>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
