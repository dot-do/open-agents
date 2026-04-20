import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessionTemplates } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import { scopedQuery } from "@/lib/db/tenant-guard";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";

/**
 * Session templates — tenant-scoped presets for session creation.
 *
 * Admin+ can create/update/delete; any member can read/use.
 */

export type SessionTemplateDTO = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  modelId: string | null;
  systemPrompt: string | null;
  skillRefs: GlobalSkillRef[] | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDTO(
  row: typeof sessionTemplates.$inferSelect,
): SessionTemplateDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    modelId: row.modelId,
    systemPrompt: row.systemPrompt,
    skillRefs: row.skillRefs,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

export type CreateTemplateInput = {
  name: string;
  description?: string | null;
  modelId?: string | null;
  systemPrompt?: string | null;
  skillRefs?: GlobalSkillRef[] | null;
};

export async function createTemplate(
  ctx: TenantContext,
  data: CreateTemplateInput,
): Promise<SessionTemplateDTO> {
  if (!isAdmin(ctx.role)) {
    throw new Error("forbidden");
  }
  const id = nanoid();
  const now = new Date();
  const [row] = await db
    .insert(sessionTemplates)
    .values({
      id,
      tenantId: ctx.tenantId,
      name: data.name,
      description: data.description ?? null,
      modelId: data.modelId ?? null,
      systemPrompt: data.systemPrompt ?? null,
      skillRefs: data.skillRefs ?? null,
      createdByUserId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toDTO(row!);
}

export async function listTemplates(
  ctx: TenantContext,
): Promise<SessionTemplateDTO[]> {
  const sq = scopedQuery(ctx);
  const rows = (await sq.selectFrom(sessionTemplates)) as (typeof sessionTemplates.$inferSelect)[];
  // Sort newest first in JS since scopedQuery returns unknown builder
  rows.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return rows.map(toDTO);
}

export async function getTemplate(
  ctx: TenantContext,
  id: string,
): Promise<SessionTemplateDTO | null> {
  const rows = (await scopedQuery(ctx).selectFrom(
    sessionTemplates,
    eq(sessionTemplates.id, id),
  )) as (typeof sessionTemplates.$inferSelect)[];
  const row = rows[0];
  return row ? toDTO(row) : null;
}

export type UpdateTemplateInput = {
  name?: string;
  description?: string | null;
  modelId?: string | null;
  systemPrompt?: string | null;
  skillRefs?: GlobalSkillRef[] | null;
};

export async function updateTemplate(
  ctx: TenantContext,
  id: string,
  data: UpdateTemplateInput,
): Promise<SessionTemplateDTO | null> {
  if (!isAdmin(ctx.role)) {
    throw new Error("forbidden");
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.modelId !== undefined) updates.modelId = data.modelId;
  if (data.systemPrompt !== undefined)
    updates.systemPrompt = data.systemPrompt;
  if (data.skillRefs !== undefined) updates.skillRefs = data.skillRefs;

  await scopedQuery(ctx).updateSet(
    sessionTemplates,
    eq(sessionTemplates.id, id),
    updates,
  );
  return getTemplate(ctx, id);
}

export async function deleteTemplate(
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  if (!isAdmin(ctx.role)) {
    throw new Error("forbidden");
  }
  await scopedQuery(ctx).deleteFrom(
    sessionTemplates,
    eq(sessionTemplates.id, id),
  );
  return true;
}
