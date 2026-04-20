"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  modelId: string | null;
  systemPrompt: string | null;
  createdAt: string;
};

function formatDate(iso: string): string {
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

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/templates", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load templates");
        return;
      }
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      setError("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setName("");
    setDescription("");
    setModelId("");
    setSystemPrompt("");
    setSubmitError(null);
    setDialogOpen(true);
  }

  function openEdit(t: TemplateRow) {
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description ?? "");
    setModelId(t.modelId ?? "");
    setSystemPrompt(t.systemPrompt ?? "");
    setSubmitError(null);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setSubmitError("Name is required");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        modelId: modelId.trim() || null,
        systemPrompt: systemPrompt.trim() || null,
      };
      const url = editingId
        ? `/api/tenant/templates/${editingId}`
        : "/api/tenant/templates";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error ?? "Failed to save template");
        return;
      }
      setDialogOpen(false);
      load();
    } catch {
      setSubmitError("Failed to save template");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      await fetch(`/api/tenant/templates/${id}`, { method: "DELETE" });
      load();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Session Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable presets for session creation with pre-configured model,
            system prompt, and skills.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit template" : "Create template"}
              </DialogTitle>
              <DialogDescription>
                {editingId
                  ? "Update the template details."
                  : "Create a reusable session template."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bug fix helper"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-desc">Description</Label>
                <Input
                  id="tpl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-model">Model ID</Label>
                <Input
                  id="tpl-model"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="e.g. anthropic/claude-sonnet-4"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-prompt">System prompt</Label>
                <Textarea
                  id="tpl-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Optional system prompt prepended to agent context"
                  rows={4}
                />
              </div>
              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                {editingId ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && templates && templates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No templates yet. Create one to get started.
        </p>
      )}
      {!loading && templates && templates.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {t.name}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.description || "--"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.modelId || "default"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(t.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(t.id)}
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
  );
}
