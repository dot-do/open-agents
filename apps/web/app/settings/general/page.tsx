"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetcher } from "@/lib/swr";

type Role = "owner" | "admin" | "member" | "viewer";

type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
};

type TenantsInfo = {
  activeTenantId: string | null;
  memberships: Array<{ tenantId: string; role: Role }>;
};

export default function GeneralSettingsPage() {
  const { data: tenantsInfo } = useSWR<TenantsInfo>("/api/tenants", fetcher);
  const currentRole: Role =
    tenantsInfo?.memberships.find(
      (m) => m.tenantId === tenantsInfo.activeTenantId,
    )?.role ?? "viewer";
  const canEdit = currentRole === "owner" || currentRole === "admin";

  const { data, mutate } = useSWR<{ tenant: TenantInfo }>(
    "/api/tenant/settings",
    fetcher,
  );

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (data?.tenant) {
      setName(data.tenant.name);
      setSlug(data.tenant.slug);
      setLogoUrl(data.tenant.logoUrl ?? "");
      setDescription(data.tenant.description ?? "");
    }
  }, [data]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      setSuccess(false);
      try {
        const res = await fetch("/api/tenant/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            logoUrl: logoUrl.trim() || null,
            description: description.trim() || null,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Failed to save.");
          return;
        }
        setSuccess(true);
        await mutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      } finally {
        setSaving(false);
      }
    },
    [name, slug, logoUrl, description, mutate],
  );

  if (!canEdit) {
    return (
      <>
        <h1 className="text-2xl font-semibold">General</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to manage workspace settings.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">General</h1>
      <form onSubmit={handleSubmit} className="max-w-lg space-y-5">
        <div className="space-y-2">
          <Label htmlFor="tenant-name">Workspace name</Label>
          <Input
            id="tenant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-slug">Slug</Label>
          <Input
            id="tenant-slug"
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            maxLength={50}
            minLength={3}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
          <p className="text-xs text-muted-foreground">
            3-50 characters, lowercase alphanumeric and dashes.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-logo-url">Logo URL</Label>
          <Input
            id="tenant-logo-url"
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://example.com/logo.png"
          />
          <p className="text-xs text-muted-foreground">
            Optional. URL to your workspace logo image.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-description">Description</Label>
          <Textarea
            id="tenant-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="A brief description of this workspace."
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">Settings saved.</p>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>
    </>
  );
}
