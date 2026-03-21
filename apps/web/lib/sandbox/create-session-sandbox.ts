import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getUserById } from "@/lib/db/users";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "./config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "./lifecycle";
import { kickSandboxLifecycleWorkflow } from "./lifecycle-kick";
import {
  getVercelCliSandboxSetup,
  syncVercelCliAuthToSandbox,
} from "./vercel-cli-auth";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

export class CreateSessionSandboxError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CreateSessionSandboxError";
    this.status = status;
  }
}

async function resolveGitHubToken(
  userId: string,
  sessionRecord: SessionRecord,
): Promise<string | null> {
  if (sessionRecord.repoOwner) {
    try {
      const tokenResult = await getRepoToken(userId, sessionRecord.repoOwner);
      return tokenResult.token;
    } catch {
      throw new CreateSessionSandboxError(
        "Connect GitHub to access repositories",
        403,
      );
    }
  }

  return getUserGitHubToken();
}

async function resolveGitUser(userId: string): Promise<{
  name: string;
  email: string;
}> {
  const [user, githubAccount] = await Promise.all([
    getUserById(userId),
    getGitHubAccount(userId),
  ]);

  if (!user) {
    throw new CreateSessionSandboxError("User not found", 404);
  }

  const githubNoreplyEmail =
    githubAccount?.externalUserId && githubAccount.username
      ? `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`
      : undefined;

  return {
    name: user.name ?? githubAccount?.username ?? user.username,
    email:
      githubNoreplyEmail ??
      user.email ??
      `${user.username}@users.noreply.github.com`,
  };
}

export async function syncVercelProjectEnvVarsToSandbox(params: {
  userId: string;
  sessionRecord: SessionRecord;
  sandbox: ConnectedSandbox;
}): Promise<void> {
  if (!params.sessionRecord.vercelProjectId) {
    return;
  }

  const token = await getUserVercelToken(params.userId);
  if (!token) {
    return;
  }

  const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
    token,
    projectIdOrName: params.sessionRecord.vercelProjectId,
    teamId: params.sessionRecord.vercelTeamId,
  });
  if (!dotenvContent) {
    return;
  }

  await params.sandbox.writeFile(
    `${params.sandbox.workingDirectory}/.env.local`,
    dotenvContent,
    "utf-8",
  );
}

export async function syncVercelCliAuthForSandbox(params: {
  userId: string;
  sessionRecord: SessionRecord;
  sandbox: ConnectedSandbox;
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

export async function createSessionSandboxForUser(params: {
  userId: string;
  sessionId: string;
}): Promise<{
  createdAt: number;
  timeout: number;
  currentBranch?: string;
  mode: "vercel";
  timing: { readyMs: number };
}> {
  const sessionRecord = await getSessionById(params.sessionId);
  if (!sessionRecord) {
    throw new CreateSessionSandboxError("Session not found", 404);
  }

  if (sessionRecord.userId !== params.userId) {
    throw new CreateSessionSandboxError("Forbidden", 403);
  }

  const [githubToken, gitUser] = await Promise.all([
    resolveGitHubToken(params.userId, sessionRecord),
    resolveGitUser(params.userId),
  ]);

  const env: Record<string, string> = {};
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
  }

  const repoUrl =
    sessionRecord.cloneUrl ??
    (sessionRecord.repoOwner && sessionRecord.repoName
      ? `https://github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}`
      : undefined);
  const startTime = Date.now();

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: sessionRecord.isNewBranch
          ? undefined
          : (sessionRecord.branch ?? "main"),
        newBranch: sessionRecord.isNewBranch
          ? (sessionRecord.branch ?? "main")
          : undefined,
        token: githubToken ?? undefined,
      }
    : undefined;

  const sandbox = await connectSandbox({
    state: {
      type: "vercel",
      source,
    },
    options: {
      env,
      gitUser,
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      ports: DEFAULT_SANDBOX_PORTS,
      baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    },
  });

  if (sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(params.sessionId, {
      sandboxState: nextState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildActiveLifecycleUpdate(nextState),
    });

    try {
      await syncVercelProjectEnvVarsToSandbox({
        userId: params.userId,
        sessionRecord,
        sandbox,
      });
    } catch (error) {
      console.error(
        `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
        error,
      );
    }

    try {
      await syncVercelCliAuthForSandbox({
        userId: params.userId,
        sessionRecord,
        sandbox,
      });
    } catch (error) {
      console.error(
        `Failed to prepare Vercel CLI auth for session ${sessionRecord.id}:`,
        error,
      );
    }

    kickSandboxLifecycleWorkflow({
      sessionId: params.sessionId,
      reason: "sandbox-created",
    });
  }

  return {
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch: sandbox.currentBranch ?? sessionRecord.branch ?? undefined,
    mode: "vercel",
    timing: {
      readyMs: Date.now() - startTime,
    },
  };
}
