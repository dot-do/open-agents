"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
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

type SsoProvider = "workos" | "clerk" | "saml-generic";

type SsoConfig = {
  tenantId: string;
  provider: SsoProvider;
  connectionId: string | null;
  domain: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
} | null;

type Role = "owner" | "admin" | "member" | "viewer";

type TenantsInfo = {
  activeTenantId: string | null;
  memberships: Array<{ tenantId: string; role: Role }>;
};

const PROVIDERS: SsoProvider[] = ["workos", "clerk", "saml-generic"];

/**
 * Settings → SSO page.
 *
 * Gated server-side via `assertPlanAllows(ctx, 'sso')` on the API route;
 * for non-enterprise plans the fetch returns 402 and this page shows an
 * upgrade prompt. Only admins (role>=admin) can save.
 */
export default function SsoSettingsPage() {
  const { data: tenantsInfo } = useSWR<TenantsInfo>("/api/tenants", fetcher);
  const currentRole: Role =
    tenantsInfo?.memberships.find(
      (m) => m.tenantId === tenantsInfo.activeTenantId,
    )?.role ?? "viewer";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const [config, setConfig] = useState<SsoConfig>(null);
  const [planBlocked, setPlanBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provider, setProvider] = useState<SsoProvider>("workos");
  const [domain, setDomain] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/tenant/sso");
      if (res.status === 402) {
        setPlanBlocked(true);
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.error ?? "failed to load");
        return;
      }
      const c: SsoConfig = json.config ?? null;
      setConfig(c);
      if (c) {
        setProvider(c.provider);
        setDomain(c.domain ?? "");
        setConnectionId(c.connectionId ?? "");
        setEnabled(c.enabled);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const save = useCallback(async () => {
    setSaveBusy(true);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      const res = await fetch("/api/tenant/sso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, domain, connectionId, enabled }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveErr(json.error ?? "save failed");
        return;
      }
      setConfig(json.config);
      setSaveMsg("Saved.");
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSaveBusy(false);
    }
  }, [provider, domain, connectionId, enabled]);

  if (loading) {
    return (
      <>
        <h1 className="text-2xl font-semibold">SSO</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  if (planBlocked) {
    return (
      <>
        <h1 className="text-2xl font-semibold">SSO</h1>
        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Enterprise plan required</p>
          <p className="mt-1 text-muted-foreground">
            SAML / OIDC single sign-on is available on the enterprise plan.
            Upgrade in <a className="underline" href="/settings/billing">Billing</a>
            {" "}or contact sales to enable this feature for your workspace.
          </p>
        </div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <h1 className="text-2xl font-semibold">SSO</h1>
        <p className="text-sm text-muted-foreground">
          You don't have permission to configure SSO.
        </p>
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">SSO</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure single sign-on for your workspace. Users whose email
          domain matches the configured domain will be routed to your
          identity provider at login.
        </p>
      </div>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Current configuration
        </h2>
        <div className="rounded-md border border-border p-4 text-sm">
          {config ? (
            <dl className="grid grid-cols-[max-content,1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{config.provider}</dd>
              <dt className="text-muted-foreground">Domain</dt>
              <dd>{config.domain ?? "—"}</dd>
              <dt className="text-muted-foreground">Connection ID</dt>
              <dd className="break-all">{config.connectionId ?? "—"}</dd>
              <dt className="text-muted-foreground">Enabled</dt>
              <dd>{config.enabled ? "yes" : "no"}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              No SSO configured yet.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Configure
        </h2>
        <div className="space-y-2">
          <Label htmlFor="sso-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as SsoProvider)}
          >
            <SelectTrigger id="sso-provider" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sso-domain">Email domain</Label>
          <Input
            id="sso-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            Logins from this email domain will be routed to your IdP.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sso-connection">Connection ID</Label>
          <Input
            id="sso-connection"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            placeholder="conn_..."
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            Opaque handle issued by your provider (WorkOS connection id,
            Clerk org id, SAML IdP entity id, …).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="sso-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Label htmlFor="sso-enabled">Enabled</Label>
        </div>

        {saveErr && <p className="text-sm text-destructive">{saveErr}</p>}
        {saveMsg && <p className="text-sm text-muted-foreground">{saveMsg}</p>}

        <div>
          <Button onClick={save} disabled={saveBusy}>
            {saveBusy ? "Saving…" : "Save configuration"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Note: this scaffold persists the configuration row but the login
          handshake is not wired. Enabling SSO has no effect until an
          operator installs the provider SDK and configures the
          corresponding env vars — see{" "}
          <code>docs/SELF_HOST_MULTITENANT.md</code>.
        </p>
      </section>
    </>
  );
}
