"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetcher } from "@/lib/swr";

type Role = "owner" | "admin" | "member" | "viewer";

type TenantsInfo = {
  activeTenantId: string | null;
  memberships: Array<{
    tenantId: string;
    tenantSlug?: string;
    tenantName?: string;
    role: Role;
  }>;
};

type MemberRow = {
  userId: string;
  role: Role;
  username: string;
  name: string | null;
  email: string | null;
};

type MembersResponse = {
  members: MemberRow[];
};

export default function DangerZonePage() {
  const router = useRouter();
  const { data: tenantsInfo } = useSWR<TenantsInfo>("/api/tenants", fetcher);
  const { data: membersData } = useSWR<MembersResponse>(
    "/api/tenant/members",
    fetcher,
  );

  const activeId = tenantsInfo?.activeTenantId ?? null;
  const active = tenantsInfo?.memberships.find(
    (m) => m.tenantId === activeId,
  );
  const role: Role = active?.role ?? "viewer";
  const isOwner = role === "owner";
  const slug = active?.tenantSlug ?? activeId ?? "";

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transfer ownership state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferConfirmText, setTransferConfirmText] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);

  // Other members eligible for transfer (non-owner members).
  const transferCandidates =
    membersData?.members.filter((m) => m.role !== "owner") ?? [];
  const transferConfirmMatches =
    transferConfirmText === slug && slug.length > 0;

  const onTransfer = useCallback(async () => {
    if (!transferTarget) return;
    setTransferBusy(true);
    setTransferError(null);
    setTransferSuccess(false);
    try {
      const res = await fetch("/api/tenant/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: transferTarget }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTransferError(json.error ?? "Transfer failed");
        return;
      }
      setTransferSuccess(true);
      setTransferOpen(false);
      setTransferTarget("");
      setTransferConfirmText("");
      router.refresh();
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setTransferBusy(false);
    }
  }, [transferTarget, slug, router]);

  const onExport = useCallback(() => {
    if (!activeId) return;
    // Trigger download via a hidden link — preserves cookies and avoids
    // buffering the full NDJSON in memory.
    const url = `/api/tenants/${encodeURIComponent(activeId)}/export`;
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [activeId]);

  const onDelete = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(activeId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSlug: confirmText }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "failed");
        return;
      }
      setDeleteOpen(false);
      router.push("/sessions");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }, [activeId, confirmText, router]);

  if (!tenantsInfo) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Danger zone</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  if (!isOwner) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Danger zone</h1>
        <p className="text-sm text-muted-foreground">
          Only workspace owners can export or delete the workspace.
        </p>
      </>
    );
  }

  const confirmMatches = confirmText === slug && slug.length > 0;

  return (
    <>
      <h1 className="text-2xl font-semibold">Danger zone</h1>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h2 className="text-sm font-medium">Export all data</h2>
        <p className="text-sm text-muted-foreground">
          Download an NDJSON dump of every row owned by this workspace. API
          key ciphertext and Stripe secrets are redacted.
        </p>
        <Button variant="outline" size="sm" onClick={onExport}>
          Export all data
        </Button>
      </section>

      {transferSuccess && (
        <p className="text-sm text-green-600">
          Ownership transferred successfully. You have been demoted to admin.
        </p>
      )}

      <section className="space-y-3 rounded-md border border-border p-4">
        <h2 className="text-sm font-medium">Transfer ownership</h2>
        <p className="text-sm text-muted-foreground">
          Transfer ownership of this workspace to another member. You will be
          demoted to admin.
        </p>
        {transferCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No other members to transfer to. Invite someone first.
          </p>
        ) : (
          <Dialog
            open={transferOpen}
            onOpenChange={(open) => {
              setTransferOpen(open);
              if (!open) {
                setTransferTarget("");
                setTransferConfirmText("");
                setTransferError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Transfer ownership
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer ownership</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select the new owner and type the workspace slug{" "}
                  <code className="font-mono">{slug}</code> to confirm.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="transfer-target">New owner</Label>
                  <Select
                    value={transferTarget}
                    onValueChange={setTransferTarget}
                  >
                    <SelectTrigger id="transfer-target">
                      <SelectValue placeholder="Select a member" />
                    </SelectTrigger>
                    <SelectContent>
                      {transferCandidates.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name ?? m.username} ({m.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transfer-confirm-slug">
                    Type slug to confirm
                  </Label>
                  <Input
                    id="transfer-confirm-slug"
                    value={transferConfirmText}
                    onChange={(e) => setTransferConfirmText(e.target.value)}
                    placeholder={slug}
                    autoComplete="off"
                  />
                </div>
                {transferError && (
                  <p className="text-sm text-destructive">{transferError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTransferOpen(false)}
                  disabled={transferBusy}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    !transferTarget || !transferConfirmMatches || transferBusy
                  }
                  onClick={onTransfer}
                >
                  {transferBusy ? "Transferring..." : "Transfer ownership"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-destructive/50 p-4">
        <h2 className="text-sm font-medium text-destructive">
          Delete workspace
        </h2>
        <p className="text-sm text-muted-foreground">
          Permanently deletes <code className="font-mono">{slug}</code>,
          cancels its Stripe subscription, archives the Stripe customer,
          terminates any running sandboxes, and cascades every tenant-scoped
          row. This cannot be undone. If you are the last owner, you will
          lose the ability to revoke billing after deletion — this is
          intentional since the workspace no longer exists.
        </p>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Delete workspace
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete workspace?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Type the workspace slug{" "}
                <code className="font-mono">{slug}</code> to confirm. This
                cancels the Stripe subscription and permanently deletes all
                data for this workspace.
              </p>
              <div className="space-y-2">
                <Label htmlFor="confirm-slug">Slug</Label>
                <Input
                  id="confirm-slug"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={slug}
                  autoComplete="off"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!confirmMatches || busy}
                onClick={onDelete}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </>
  );
}
