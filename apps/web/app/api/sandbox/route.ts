import type { NextRequest } from "next/server";
import { checkBotId } from "botid/server";
import { botIdConfig } from "@/lib/botid";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { withRateLimit } from "@/lib/rate-limit";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { getGitHubAccount } from "@/lib/db/accounts";
import { updateSession } from "@/lib/db/sessions";
import { parseGitHubUrl } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  getVercelCliSandboxSetup,
  syncVercelCliAuthToSandbox,
} from "@/lib/sandbox/vercel-cli-auth";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getSessionSandboxName,
  hasResumableSandboxState,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import {
  QuotaExceededError,
  checkConcurrencyQuota,
  countActiveSandboxes,
} from "@/lib/quotas";
import { getPlan, PLAN_MATRIX } from "@/lib/billing";
import { audit, withTenantTags } from "@/lib/audit";
import { safeEnqueueEvent } from "@/lib/webhooks";
// import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
// import { getUserVercelToken } from "@/lib/vercel/token";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxType?: "vercel";
}

// async function syncVercelProjectEnvVarsToSandbox(params: {
//   userId: string;
//   sessionRecord: SessionRecord;
//   sandbox: Awaited<ReturnType<typeof connectSandbox>>;
// }): Promise<void> {
//   if (!params.sessionRecord.vercelProjectId) {
//     return;
//   }
//
//   const token = await getUserVercelToken(params.userId);
//   if (!token) {
//     return;
//   }
//
//   const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
//     token,
//     projectIdOrName: params.sessionRecord.vercelProjectId,
//     teamId: params.sessionRecord.vercelTeamId,
//   });
//   if (!dotenvContent) {
//     return;
//   }
//
//   await params.sandbox.writeFile(
//     `${params.sandbox.workingDirectory}/.env.local`,
//     dotenvContent,
//     "utf-8",
//   );
// }

async function syncVercelCliAuthForSandbox(params: {
  userId: string;
  sessionRecord: SessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<void> {
  const setup = await getVercelCliSandboxSetup({
    userId: params.userId,
    sessionRecord: params.sessionRecord,
  });

  await syncVercelCliAuthToSandbox({
    sandbox: params.sandbox,
    setup,
  });
}

async function installSessionGlobalSkills(params: {
  sessionRecord: SessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<void> {
  const globalSkillRefs = params.sessionRecord.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  await installGlobalSkills({
    sandbox: params.sandbox,
    globalSkillRefs,
  });
}

async function postHandler(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  const { repoUrl, branch = "main", isNewBranch = false, sessionId } = body;

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  // Resolve tenant context (Wave 1 tenancy helper). Used for metadata tagging
  // and concurrency/minutes/cost quota enforcement.
  let tenantCtx;
  try {
    tenantCtx = await requireTenantCtx(req as unknown as import("next/server").NextRequest);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  // Plan gate: concurrent_sandboxes cap per plan matrix. Runs alongside
  // the numeric quota below — whichever is lower wins.
  try {
    const plan = await getPlan({ tenantId: tenantCtx.tenantId });
    const planCap = PLAN_MATRIX[plan].concurrent_sandboxes;
    if (planCap !== "custom") {
      const active = await countActiveSandboxes(tenantCtx.tenantId);
      if (active >= planCap) {
        return Response.json(
          {
            error: "plan_upgrade_required",
            feature: "concurrent_sandboxes",
            plan,
            limit: planCap,
            current: active,
          },
          { status: 402 },
        );
      }
    }
  } catch (error) {
    // Fail open on plan lookup so a billing outage can't block spawns.
    console.warn("[billing] plan check failed:", error);
  }

  try {
    await checkConcurrencyQuota(tenantCtx.tenantId);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return Response.json(
        {
          error: error.message,
          code: "quota_exceeded",
          quota: error.quota,
          limit: error.limit,
          current: error.current,
        },
        { status: 429 },
      );
    }
    throw error;
  }

  const githubToken = await getUserGitHubToken(session.user.id);

  if (repoUrl) {
    const parsedRepo = parseGitHubUrl(repoUrl);
    if (!parsedRepo) {
      return Response.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 },
      );
    }

    if (!githubToken) {
      return Response.json(
        { error: "Connect GitHub to access repositories" },
        { status: 403 },
      );
    }
  }

  // Validate session ownership
  let sessionRecord: SessionRecord | undefined;
  if (sessionId) {
    const sessionContext = await requireOwnedSession({
      userId: session.user.id,
      sessionId,
      tenantId: session.activeTenantId ?? undefined,
    });
    if (!sessionContext.ok) {
      return sessionContext.response;
    }

    sessionRecord = sessionContext.sessionRecord;
  }

  const sandboxName = sessionId ? getSessionSandboxName(sessionId) : undefined;
  const githubAccount = await getGitHubAccount(session.user.id);
  const githubNoreplyEmail =
    githubAccount?.externalUserId && githubAccount.username
      ? `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`
      : undefined;

  const gitUser = {
    name: session.user.name ?? githubAccount?.username ?? session.user.username,
    email:
      githubNoreplyEmail ??
      session.user.email ??
      `${session.user.username}@users.noreply.github.com`,
  };

  // ============================================
  // CREATE OR RESUME: Create a named persistent sandbox for this session.
  // ============================================
  const startTime = Date.now();

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: isNewBranch ? undefined : branch,
        newBranch: isNewBranch ? branch : undefined,
      }
    : undefined;

  const sandbox = await withTenantTags(
    tenantCtx,
    "sandbox.provision",
    async () =>
  await connectSandbox({
    state: {
      type: "vercel",
      ...(sandboxName ? { sandboxName } : {}),
      source,
    },
    options: {
      githubToken: githubToken ?? undefined,
      gitUser,
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      ports: DEFAULT_SANDBOX_PORTS,
      baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
      persistent: !!sandboxName,
      resume: !!sandboxName,
      createIfMissing: !!sandboxName,
      metadata: {
        tenantId: tenantCtx.tenantId,
        userId: session.user.id,
        ...(sessionId ? { sessionId } : {}),
      },
    },
  }),
  );

  if (sessionId) {
    await audit(tenantCtx, "session.created", {
      target: sessionId,
      metadata: { repoUrl: repoUrl ?? null, branch: repoUrl ? branch : null },
    });
    // Fan out to tenant webhook subscribers — never break the spawn flow.
    void safeEnqueueEvent(tenantCtx.tenantId, "session.created", {
      sessionId,
      repoUrl: repoUrl ?? null,
      branch: repoUrl ? branch : null,
    });
  }

  if (sessionId && sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    if (sessionRecord) {
      // TODO: Re-enable this once we have a solid exfiltration defense strategy.
      // try {
      //   await syncVercelProjectEnvVarsToSandbox({
      //     userId: session.user.id,
      //     sessionRecord,
      //     sandbox,
      //   });
      // } catch (error) {
      //   console.error(
      //     `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
      //     error,
      //   );
      // }

      try {
        await syncVercelCliAuthForSandbox({
          userId: session.user.id,
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to prepare Vercel CLI auth for session ${sessionRecord.id}:`,
          error,
        );
      }

      try {
        await installSessionGlobalSkills({
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to install global skills for session ${sessionRecord.id}:`,
          error,
        );
      }
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch: repoUrl ? branch : undefined,
    mode: "vercel",
    timing: { readyMs },
  });
}

async function deleteHandler(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let killCtx;
  try {
    killCtx = await requireTenantCtx(
      req as unknown as import("next/server").NextRequest,
    );
  } catch {
    killCtx = null;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sessionId" in body) ||
    typeof (body as Record<string, unknown>).sessionId !== "string"
  ) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const { sessionId } = body as { sessionId: string };

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    tenantId: authResult.tenantId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  await sandbox.stop();

  const clearedState = clearSandboxState(sessionRecord.sandboxState);
  await updateSession(sessionId, {
    sandboxState: clearedState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleState:
      hasResumableSandboxState(clearedState) || !!sessionRecord.snapshotUrl
        ? "hibernated"
        : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  if (killCtx) {
    await audit(killCtx, "session.killed", {
      target: sessionId,
      metadata: { reason: "user_requested" },
    });
    void safeEnqueueEvent(killCtx.tenantId, "session.killed", {
      sessionId,
      reason: "user_requested",
    });
  }

  return Response.json({ success: true });
}

export const POST = withRateLimit(
  postHandler as (req: NextRequest) => Promise<Response>,
  { category: "sandbox:write" },
) as (req: Request) => Promise<Response>;

export const DELETE = withRateLimit(
  deleteHandler as (req: NextRequest) => Promise<Response>,
  { category: "sandbox:write" },
) as (req: Request) => Promise<Response>;
