"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

type AdminTenantRow = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  plan: string;
  subscriptionStatus: string | null;
  activeSandboxes: number;
  monthlyMinutes: number;
  memberCount: number;
};

type ListResponse = { tenants: AdminTenantRow[] };

export default function AdminTenantsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const url =
    deferredSearch.length > 0
      ? `/api/admin/tenants?limit=100&search=${encodeURIComponent(deferredSearch)}`
      : "/api/admin/tenants?limit=100";
  const { data, isLoading, error } = useSWR<ListResponse>(url, fetcher, {
    keepPreviousData: true,
  });
  const rows = data?.tenants ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Cross-tenant view. Search by slug or name.
          </p>
        </div>
        <Input
          type="search"
          placeholder="Search tenants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">
          Failed to load tenants: {String(error)}
        </p>
      )}

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Active sandboxes</TableHead>
              <TableHead className="text-right">Monthly minutes</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground"
                >
                  No tenants found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t.slug}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{t.plan}</div>
                    {t.subscriptionStatus && (
                      <div className="text-xs text-muted-foreground">
                        {t.subscriptionStatus}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.activeSandboxes}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.monthlyMinutes}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.memberCount}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
