"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  XCircle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

type DomainRow = {
  id: string;
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  verificationToken: string;
  sslStatus: "pending" | "active" | "error";
  createdAt: string;
};

function SslBadge({ status }: { status: DomainRow["sslStatus"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        SSL Active
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600">
        <XCircle className="h-3 w-3" />
        SSL Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-700">
      <ShieldAlert className="h-3 w-3" />
      SSL Pending
    </span>
  );
}

export default function DomainsPage() {
  const { data, mutate, isLoading } = useSWR<{ domains: DomainRow[] }>(
    "/api/tenant/domains",
    fetcher,
  );
  const domains = data?.domains ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    id: string;
    verified: boolean;
    error?: string;
  } | null>(null);

  const onAdd = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/tenant/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add domain");
      }
      setDialogOpen(false);
      setDomainInput("");
      await mutate();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [domainInput, mutate]);

  const onVerify = useCallback(
    async (id: string) => {
      setVerifyingId(id);
      setVerifyResult(null);
      try {
        const res = await fetch(`/api/tenant/domains/${id}/verify`, {
          method: "POST",
        });
        const body = await res.json();
        setVerifyResult({ id, verified: body.verified, error: body.error });
        if (body.verified) {
          await mutate();
        }
      } catch (err) {
        setVerifyResult({
          id,
          verified: false,
          error: err instanceof Error ? err.message : "Verification failed",
        });
      } finally {
        setVerifyingId(null);
      }
    },
    [mutate],
  );

  const onRemove = useCallback(
    async (id: string) => {
      if (!confirm("Remove this domain?")) return;
      const res = await fetch(`/api/tenant/domains/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Failed to remove domain");
        return;
      }
      await mutate();
    },
    [mutate],
  );

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Custom Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your own domain to this workspace. Requires DNS verification
            before activation.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add custom domain</DialogTitle>
              <DialogDescription>
                Enter a bare domain (e.g. app.example.com). After adding, you
                will need to create a DNS TXT record to verify ownership.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="app.example.com"
                  autoComplete="off"
                />
              </div>
              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={onAdd}
                disabled={submitting || !domainInput.trim()}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Add domain
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border border-border">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading domains...
          </div>
        ) : domains.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Globe className="h-8 w-8 opacity-50" />
            No custom domains configured. Add one to serve your workspace from
            your own domain.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSL</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.domain}</TableCell>
                  <TableCell>
                    {d.verified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-700">
                        Pending
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SslBadge status={d.sslStatus} />
                  </TableCell>
                  <TableCell>
                    {!d.verified && (
                      <div className="space-y-2">
                        <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                          <p className="mb-1 font-medium">
                            Add this DNS TXT record:
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="break-all">
                              _open-agents-verify.{d.domain}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  `_open-agents-verify.${d.domain}`,
                                )
                              }
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="mt-1 text-muted-foreground">Value:</p>
                          <div className="flex items-center gap-2">
                            <code className="break-all">
                              {d.verificationToken}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  d.verificationToken,
                                )
                              }
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {verifyResult?.id === d.id && !verifyResult.verified && (
                          <p className="text-xs text-destructive">
                            {verifyResult.error}
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {!d.verified && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onVerify(d.id)}
                          disabled={verifyingId === d.id}
                        >
                          {verifyingId === d.id && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          Verify
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(d.id)}
                        aria-label="Remove domain"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
