import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { parseGitHubUrl } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  CreateSessionSandboxError,
  createSessionSandboxForUser,
  syncVercelCliAuthForSandbox,
} from "@/lib/sandbox/create-session-sandbox";
import { canOperateOnSandbox, clearSandboxState } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxId?: string;
  sandboxType?: "vercel";
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  const { repoUrl, sessionId, sandboxId: providedSandboxId } = body;

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let githubToken: string | null = null;

  if (repoUrl) {
    const parsedRepo = parseGitHubUrl(repoUrl);
    if (!parsedRepo) {
      return Response.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 },
      );
    }

    try {
      const tokenResult = await getRepoToken(session.user.id, parsedRepo.owner);
      githubToken = tokenResult.token;
    } catch {
      return Response.json(
        { error: "Connect GitHub to access repositories" },
        { status: 403 },
      );
    }
  } else {
    githubToken = await getUserGitHubToken();
  }

  // Validate session ownership
  let sessionRecord: SessionRecord | undefined;
  if (sessionId) {
    const sessionContext = await requireOwnedSession({
      userId: session.user.id,
      sessionId,
    });
    if (!sessionContext.ok) {
      return sessionContext.response;
    }

    sessionRecord = sessionContext.sessionRecord;
  }

  const env: Record<string, string> = {};
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
  }

  // ============================================
  // RECONNECT: Existing sandbox
  // ============================================
  if (providedSandboxId) {
    const sandbox = await connectSandbox({
      state: { type: "vercel", sandboxId: providedSandboxId },
      options: { env, ports: DEFAULT_SANDBOX_PORTS },
    });

    if (sessionId && sandbox.getState) {
      const nextState = sandbox.getState() as SandboxState;
      await updateSession(sessionId, {
        sandboxState: nextState,
        lifecycleVersion: getNextLifecycleVersion(
          sessionRecord?.lifecycleVersion,
        ),
        ...buildActiveLifecycleUpdate(nextState),
      });

      if (sessionRecord) {
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
      }

      kickSandboxLifecycleWorkflow({
        sessionId,
        reason: "sandbox-created",
      });
    }

    return Response.json({
      sandboxId: providedSandboxId,
      createdAt: Date.now(),
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      currentBranch: sandbox.currentBranch,
      mode: "vercel",
    });
  }

  // ============================================
  // NEW SANDBOX: Create a Vercel sandbox
  // ============================================
  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  try {
    const result = await createSessionSandboxForUser({
      userId: session.user.id,
      sessionId,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof CreateSessionSandboxError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
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

  await updateSession(sessionId, {
    sandboxState: clearSandboxState(sessionRecord.sandboxState),
    lifecycleState: sessionRecord.snapshotUrl ? "hibernated" : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
