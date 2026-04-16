"use client";

import { useCallback, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

type Role = "owner" | "admin" | "member" | "viewer";

type MemberRow = {
  userId: string;
  role: Role;
  email: string | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
};

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

type TenantsInfo = {
  activeTenantId: string | null;
  memberships: Array<{ tenantId: string; role: Role }>;
};

export default function MembersPage() {
  const { data: tenantsInfo } = useSWR<TenantsInfo>("/api/tenants", fetcher);
  const currentRole: Role =
    tenantsInfo?.memberships.find(
      (m) => m.tenantId === tenantsInfo.activeTenantId,
    )?.role ?? "viewer";
  const isOwner = currentRole === "owner";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const { data: membersData, mutate: mutateMembers } = useSWR<{
    members: MemberRow[];
  }>(isAdmin ? "/api/tenant/members" : null, fetcher);
  const { data: invitesData, mutate: mutateInvites } = useSWR<{
    invites: InviteRow[];
  }>(isAdmin ? "/api/tenant/invites" : null, fetcher);

  const members = membersData?.members ?? [];
  const invites = invitesData?.invites ?? [];

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitInvite = useCallback(async () => {
    setInviteBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "failed");
        return;
      }
      setLastAcceptUrl(json.acceptUrl ?? null);
      setInviteEmail("");
      setInviteRole("member");
      await mutateInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setInviteBusy(false);
    }
  }, [inviteEmail, inviteRole, mutateInvites]);

  const changeRole = useCallback(
    async (userId: string, role: Role) => {
      const res = await fetch(`/api/tenant/members/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "failed to change role");
        return;
      }
      await mutateMembers();
    },
    [mutateMembers],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      if (!confirm("Remove this member from the workspace?")) return;
      const res = await fetch(`/api/tenant/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "failed to remove member");
        return;
      }
      await mutateMembers();
    },
    [mutateMembers],
  );

  const revokeInvite = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tenant/invites/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "failed to revoke invite");
        return;
      }
      await mutateInvites();
    },
    [mutateInvites],
  );

  if (!isAdmin) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          You don't have permission to manage members.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Members</h1>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Invite member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a new member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as Role)}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => r !== "owner" || isOwner).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {lastAcceptUrl && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <div className="mb-1 font-medium">Accept link (dev):</div>
                  <code className="break-all">{lastAcceptUrl}</code>
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(lastAcceptUrl)
                      }
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={inviteBusy}
              >
                Close
              </Button>
              <Button onClick={submitInvite} disabled={inviteBusy}>
                {inviteBusy ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && !inviteOpen && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Members ({members.length})
        </h2>
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isLastOwner = m.role === "owner" && ownerCount <= 1;
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">
                        {m.name ?? m.username}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        @{m.username}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            changeRole(m.userId, v as Role)
                          }
                          disabled={isLastOwner && m.role === "owner"}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">{m.role}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(m.userId)}
                        disabled={
                          isLastOwner || (m.role === "owner" && !isOwner)
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Pending invites ({invites.length})
        </h2>
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No pending invites.
                  </TableCell>
                </TableRow>
              )}
              {invites.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-sm">{inv.email}</TableCell>
                  <TableCell className="text-sm">{inv.role}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeInvite(inv.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}
