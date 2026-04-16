"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type Scope = "read" | "write" | "admin";

type TokenRow = {
  id: string;
  name: string;
  scope: Scope;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const SCOPE_LABELS: Record<Scope, string> = {
  read: "Read",
  write: "Write",
  admin: "Admin",
};

const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  read: "GET endpoints only",
  write: "Read + create/update resources",
  admin: "All actions including key/member management",
};

const EXPIRY_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusFor(token: TokenRow): {
  label: string;
  className: string;
} {
  if (token.revokedAt) {
    return {
      label: "Revoked",
      className: "bg-muted text-muted-foreground",
    };
  }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return {
      label: "Expired",
      className: "bg-amber-500/10 text-amber-600",
    };
  }
  return {
    label: "Active",
    className: "bg-emerald-500/10 text-emerald-600",
  };
}

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("read");
  const [expiryDays, setExpiryDays] = useState<string>("30");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // One-shot plaintext shown after creation. Cleared as soon as the user
  // dismisses the banner — we never re-fetch or cache this server-side.
  const [displayToken, setDisplayToken] = useState<string | null>(null);
  const [displayTokenName, setDisplayTokenName] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/api-tokens", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load tokens");
      }
      const data = await res.json();
      setTokens(data.tokens ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const days = expiryDays === "never" ? null : Number(expiryDays);
      const res = await fetch("/api/tenant/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scope,
          expiresInDays: days,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create token");
      }
      const data = await res.json();
      // Stash the plaintext for the copy-once banner BEFORE closing the
      // dialog. After this assignment the only place the secret exists is
      // browser memory — no server round-trip can recover it.
      setDisplayToken(data.display_token ?? null);
      setDisplayTokenName(name.trim());
      setDialogOpen(false);
      setName("");
      setScope("read");
      setExpiryDays("30");
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [name, scope, expiryDays, load]);

  const onCopy = useCallback(async () => {
    if (!displayToken) return;
    try {
      await navigator.clipboard.writeText(displayToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text node so the user can copy manually.
    }
  }, [displayToken]);

  const onDismissBanner = useCallback(() => {
    setDisplayToken(null);
    setDisplayTokenName("");
    setCopied(false);
  }, []);

  const onRevoke = useCallback(
    async (id: string, tokenName: string) => {
      if (
        !confirm(
          `Revoke "${tokenName}"? Clients using this token will immediately receive 401 Unauthorized.`,
        )
      ) {
        return;
      }
      const res = await fetch(`/api/tenant/api-tokens/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Failed to revoke token");
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">API Tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personal access tokens for programmatic clients. Send as{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              Authorization: Bearer oa_pat_…
            </code>
            . Plaintext is shown once at creation and never again.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Create token
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription>
                The plaintext token will be displayed once after creation. Copy
                it immediately and store it in a secrets manager — you will not
                be able to view it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. CI deploy bot"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scope">Scope</Label>
                <Select
                  value={scope}
                  onValueChange={(v) => setScope(v as Scope)}
                >
                  <SelectTrigger id="scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        <div className="flex flex-col">
                          <span>{SCOPE_LABELS[s]}</span>
                          <span className="text-xs text-muted-foreground">
                            {SCOPE_DESCRIPTIONS[s]}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry">Expires in</Label>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger id="expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_PRESETS.map((p) => (
                      <SelectItem
                        key={p.label}
                        value={p.days === null ? "never" : String(p.days)}
                      >
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {submitError ? (
                <p className="text-sm text-destructive">{submitError}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={submitting || !name.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create token
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {displayToken ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Copy your new token now — you won&apos;t see it again
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Token <span className="font-mono">{displayTokenName}</span>{" "}
                  has been created. The plaintext below exists only in this
                  page; refreshing or navigating away will discard it
                  permanently. Store it in a secrets manager.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-background px-3 py-2 font-mono text-sm">
                  {displayToken}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCopy}
                  aria-label="Copy token"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onDismissBanner}>
                  I&apos;ve saved it — dismiss
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading tokens…
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : !tokens || tokens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <KeyRound className="h-8 w-8 opacity-50" />
            No API tokens yet. Create one to authenticate programmatic
            clients.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => {
                const status = statusFor(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                        {SCOPE_LABELS[t.scope]}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.tokenHint}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(t.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevoke(t.id, t.name)}
                        aria-label="Revoke token"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
