import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { workflowRuns, workflowRunSteps } from "./schema";

export type WorkflowRunStatus = "completed" | "aborted" | "failed";

export type WorkflowRunStepTiming = {
  stepNumber: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finishReason?: string;
  rawFinishReason?: string;
};

export async function recordWorkflowRun(data: {
  id: string;
  chatId: string;
  sessionId: string;
  userId: string;
  tenantId?: string | null;
  modelId?: string;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stepTimings: WorkflowRunStepTiming[];
}) {
  await db.transaction(async (tx) => {
    await tx
      .insert(workflowRuns)
      .values({
        id: data.id,
        chatId: data.chatId,
        sessionId: data.sessionId,
        userId: data.userId,
        tenantId: data.tenantId ?? null,
        modelId: data.modelId ?? null,
        status: data.status,
        startedAt: new Date(data.startedAt),
        finishedAt: new Date(data.finishedAt),
        totalDurationMs: data.totalDurationMs,
      })
      .onConflictDoNothing({ target: workflowRuns.id });

    if (data.stepTimings.length === 0) {
      return;
    }

    await tx
      .insert(workflowRunSteps)
      .values(
        data.stepTimings.map((stepTiming) => ({
          id: nanoid(),
          workflowRunId: data.id,
          tenantId: data.tenantId ?? null,
          stepNumber: stepTiming.stepNumber,
          startedAt: new Date(stepTiming.startedAt),
          finishedAt: new Date(stepTiming.finishedAt),
          durationMs: stepTiming.durationMs,
          finishReason: stepTiming.finishReason ?? null,
          rawFinishReason: stepTiming.rawFinishReason ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [workflowRunSteps.workflowRunId, workflowRunSteps.stepNumber],
      });
  });
}

export type RecentWorkflowRunForTenant = {
  id: string;
  chatId: string;
  sessionId: string;
  modelId: string | null;
  status: WorkflowRunStatus;
  startedAt: Date;
  finishedAt: Date;
  totalDurationMs: number;
  createdAt: Date;
  stepCount: number;
};

/**
 * List the tenant's recent workflow runs with their step counts. Always
 * filters by `tenantId` to enforce tenant isolation at the data layer; callers
 * are still expected to assert membership before invoking (the
 * `/t/[tenantSlug]/layout.tsx` guard does this for the tenant-scoped UI).
 */
export async function listRecentWorkflowRunsForTenant(
  tenantId: string,
  limit = 50,
): Promise<RecentWorkflowRunForTenant[]> {
  const rows = await db
    .select({
      id: workflowRuns.id,
      chatId: workflowRuns.chatId,
      sessionId: workflowRuns.sessionId,
      modelId: workflowRuns.modelId,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      finishedAt: workflowRuns.finishedAt,
      totalDurationMs: workflowRuns.totalDurationMs,
      createdAt: workflowRuns.createdAt,
      stepCount: sql<number>`(
        select count(*)::int
        from ${workflowRunSteps}
        where ${workflowRunSteps.workflowRunId} = ${workflowRuns.id}
          and ${workflowRunSteps.tenantId} = ${tenantId}
      )`,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.tenantId, tenantId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    status: r.status as WorkflowRunStatus,
    stepCount: Number(r.stepCount ?? 0),
  }));
}

/**
 * Fetch a single workflow run scoped to the caller's tenant. Returns
 * undefined if the run id doesn't belong to this tenant — never leaks rows
 * across tenants even when an attacker guesses ids.
 */
export async function getWorkflowRunForTenant(
  runId: string,
  tenantId: string,
): Promise<RecentWorkflowRunForTenant | undefined> {
  const rows = await db
    .select({
      id: workflowRuns.id,
      chatId: workflowRuns.chatId,
      sessionId: workflowRuns.sessionId,
      modelId: workflowRuns.modelId,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      finishedAt: workflowRuns.finishedAt,
      totalDurationMs: workflowRuns.totalDurationMs,
      createdAt: workflowRuns.createdAt,
      stepCount: sql<number>`(
        select count(*)::int
        from ${workflowRunSteps}
        where ${workflowRunSteps.workflowRunId} = ${workflowRuns.id}
          and ${workflowRunSteps.tenantId} = ${tenantId}
      )`,
    })
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return {
    ...row,
    status: row.status as WorkflowRunStatus,
    stepCount: Number(row.stepCount ?? 0),
  };
}
