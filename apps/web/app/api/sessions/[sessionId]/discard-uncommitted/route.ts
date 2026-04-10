import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function toGitErrorMessage(result: {
  stderr?: string;
  stdout?: string;
}): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

function isEmptyIndexError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("pathspec") &&
    normalized.includes("did not match any files")
  );
}

export async function POST(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before discarding changes",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    const repoResult = await sandbox.exec(
      "git rev-parse --show-toplevel",
      cwd,
      10000,
    );
    if (!repoResult.success) {
      return Response.json(
        { error: "Sandbox working directory is not a git repository" },
        { status: 400 },
      );
    }

    const hasHeadResult = await sandbox.exec(
      "git rev-parse --verify HEAD",
      cwd,
      10000,
    );
    if (hasHeadResult.success) {
      const resetResult = await sandbox.exec(
        "git reset --hard HEAD",
        cwd,
        30000,
      );
      if (!resetResult.success) {
        return Response.json(
          { error: toGitErrorMessage(resetResult) },
          { status: 500 },
        );
      }
    } else {
      const clearIndexResult = await sandbox.exec(
        "git rm -rf --cached .",
        cwd,
        30000,
      );
      if (
        !clearIndexResult.success &&
        !isEmptyIndexError(toGitErrorMessage(clearIndexResult))
      ) {
        return Response.json(
          { error: toGitErrorMessage(clearIndexResult) },
          { status: 500 },
        );
      }
    }

    const cleanResult = await sandbox.exec("git clean -fd", cwd, 30000);
    if (!cleanResult.success) {
      return Response.json(
        { error: toGitErrorMessage(cleanResult) },
        { status: 500 },
      );
    }

    const statusResult = await sandbox.exec(
      "git status --porcelain",
      cwd,
      10000,
    );
    if (!statusResult.success) {
      return Response.json(
        { error: toGitErrorMessage(statusResult) },
        { status: 500 },
      );
    }

    return Response.json({
      discarded: true,
      hasUncommittedChanges: statusResult.stdout.trim().length > 0,
    });
  } catch (error) {
    console.error("Failed to discard uncommitted changes:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
