import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessionTemplates } from "@/lib/db/schema";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";

/**
 * Lightweight template lookup for session creation — does NOT require
 * a full TenantContext since the session route resolves auth via
 * getServerSession. Enforces tenant scoping via the tenantId parameter.
 */

export type TemplateLookup = {
  id: string;
  modelId: string | null;
  systemPrompt: string | null;
  skillRefs: GlobalSkillRef[] | null;
};

export async function getTemplateById(
  tenantId: string,
  templateId: string,
): Promise<TemplateLookup | null> {
  const rows = await db
    .select({
      id: sessionTemplates.id,
      modelId: sessionTemplates.modelId,
      systemPrompt: sessionTemplates.systemPrompt,
      skillRefs: sessionTemplates.skillRefs,
    })
    .from(sessionTemplates)
    .where(
      and(
        eq(sessionTemplates.id, templateId),
        eq(sessionTemplates.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
