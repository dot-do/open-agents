"use client";

import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { NewWorkspaceDialog } from "@/components/new-workspace-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetcher } from "@/lib/swr";

interface TenantMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: "owner" | "admin" | "member" | "viewer";
}

interface TenantsResponse {
  activeTenantId: string | null;
  memberships: TenantMembership[];
}

export function TenantSwitcher() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<TenantsResponse>(
    "/api/tenants",
    fetcher,
  );
  const [switching, setSwitching] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const memberships = data?.memberships ?? [];
  // Hide while loading and when the user has no memberships at all — the
  // new-user onboarding flow provisions a personal tenant on first login.
  if (!isLoading && memberships.length === 0) return null;

  const active = memberships.find((m) => m.tenantId === data?.activeTenantId);
  const label = active?.tenantName ?? memberships[0]?.tenantName ?? "Tenant";

  async function handleSwitch(tenantId: string) {
    if (tenantId === data?.activeTenantId) return;
    setSwitching(tenantId);
    try {
      const res = await fetch("/api/tenants/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return;
      await mutate();
      router.refresh();
    } finally {
      setSwitching(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <span className="max-w-[12rem] truncate">{label}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Switch workspace
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map((m) => {
            const isActive = m.tenantId === data?.activeTenantId;
            const isSwitching = switching === m.tenantId;
            return (
              <DropdownMenuItem
                key={m.tenantId}
                onSelect={(e) => {
                  e.preventDefault();
                  handleSwitch(m.tenantId);
                }}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{m.tenantName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.tenantSlug} · {m.role}
                  </div>
                </div>
                {isSwitching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isActive ? (
                  <Check className="h-4 w-4" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCreateOpen(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm">New workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async () => {
          await mutate();
        }}
      />
    </>
  );
}
