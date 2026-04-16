"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";

type InvitePreview = {
  email: string;
  role: string;
  tenantName: string | null;
  tenantSlug: string | null;
  expired: boolean;
  accepted: boolean;
  error?: string;
};

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const router = useRouter();
  const { isAuthenticated, loading } = useSession();
  const { data, isLoading } = useSWR<InvitePreview>(
    token ? `/api/invite/${token}` : null,
    fetcher,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated && token) {
      const returnTo = encodeURIComponent(`/invite/${token}`);
      router.replace(`/?returnTo=${returnTo}`);
    }
  }, [loading, isAuthenticated, router, token]);

  const accept = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "failed");
        return;
      }
      router.replace("/sessions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }, [token, router]);

  if (isLoading || loading) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
        Loading invite…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Invite not found</h1>
        <p className="text-sm text-muted-foreground">
          This invite link is invalid.
        </p>
      </div>
    );
  }

  if (data.accepted) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Invite already accepted</h1>
      </div>
    );
  }

  if (data.expired) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Invite expired</h1>
        <p className="text-sm text-muted-foreground">
          Ask an admin for a new invite link.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-2xl font-semibold">
        Join {data.tenantName ?? "workspace"}
      </h1>
      <p className="text-sm text-muted-foreground">
        You've been invited to join as{" "}
        <span className="font-medium">{data.role}</span>.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={accept} disabled={busy || !isAuthenticated}>
        {busy ? "Joining…" : `Join ${data.tenantName ?? "workspace"}`}
      </Button>
    </div>
  );
}
