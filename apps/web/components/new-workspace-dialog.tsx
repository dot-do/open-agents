"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NewWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tenantId: string) => void | Promise<void>;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: NewWorkspaceDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (!trimmedSlug) {
      setError("Slug is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, slug: trimmedSlug }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Failed to create workspace");
        setSubmitting(false);
        return;
      }
      const tenant = (await res.json()) as { id: string };

      // Switch to the new tenant so the user lands inside it.
      await fetch("/api/tenants/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });

      await onCreated?.(tenant.id);
      router.refresh();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!submitting) {
          onOpenChange(v);
          if (!v) reset();
        }
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Workspaces have separate members, settings, and billing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-workspace-name">Name</Label>
              <Input
                id="new-workspace-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme, Inc."
                autoFocus
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-workspace-slug">Slug</Label>
              <Input
                id="new-workspace-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="acme"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens.
              </p>
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create workspace"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
