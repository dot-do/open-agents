import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  buildHibernatedLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  canOperateOnSandbox,
  clearSandboxState,
  hasRuntimeSandboxState,
  isPersistentSandbox,
} from "@/lib/sandbox/utils";

interface CreateSnapshotRequest {
  sessionId: string;
}

interface RestoreSnapshotRequest {
  sessionId: string;
}

/**
 * POST - Create a snapshot of the sandbox filesystem.
 * IMPORTANT: This automatically stops the sandbox after snapshot creation.
 */
export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: CreateSnapshotRequest;
  try {
    body = (await req.json()) as CreateSnapshotRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: canOperateOnSandbox,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);

    if (!sandbox.snapshot) {
      return Response.json(
        { error: "Snapshot not supported by this sandbox type" },
        { status: 400 },
      );
    }

    // Create snapshot (automatically stops the sandbox)
    const result = await sandbox.snapshot();

    // Update session with snapshot info (now stores snapshotId instead of downloadUrl)
    // Also clear sandbox state but preserve the type (and name for persistent) for future restoration
    const clearedState = clearSandboxState(sessionRecord.sandboxState);

    await updateSession(sessionId, {
      snapshotUrl: result.snapshotId,
      snapshotCreatedAt: new Date(),
      sandboxState: clearedState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildHibernatedLifecycleUpdate(),
    });

    return Response.json({
      snapshotId: result.snapshotId,
      createdAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: `Failed to create snapshot: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * PUT - Restore a sandbox session.
 *
 * For persistent sandboxes (has `name` in state): uses Sandbox.get({ name })
 * which auto-resumes the stopped sandbox.
 *
 * For legacy sessions (no `name`, has `snapshotUrl`): lazy-migrates to a
 * persistent sandbox by creating one from the snapshot with name `session_<id>`.
 */
export async function PUT(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: RestoreSnapshotRequest;
  try {
    body = (await req.json()) as RestoreSnapshotRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // --- Persistent sandbox path: has a name, just resume ---
  if (isPersistentSandbox(sessionRecord.sandboxState)) {
    // Already running?
    if (
      sessionRecord.sandboxState &&
      "expiresAt" in sessionRecord.sandboxState &&
      sessionRecord.sandboxState.expiresAt &&
      Date.now() < sessionRecord.sandboxState.expiresAt
    ) {
      console.log(
        `[Snapshot Restore] session=${sessionId} already_running=true persistent=true`,
      );
      return Response.json({
        success: true,
        alreadyRunning: true,
        restoredFrom: "persistent",
      });
    }

    try {
      // Sandbox.get({ name }) + auto-resume
      const sandboxState = sessionRecord.sandboxState!;
      const sandbox = await connectSandbox(sandboxState);

      const newState = sandbox.getState?.();
      const restoredState = (newState ??
        sessionRecord.sandboxState) as Parameters<
        typeof updateSession
      >[1]["sandboxState"];

      await updateSession(sessionId, {
        sandboxState: restoredState,
        lifecycleVersion: getNextLifecycleVersion(
          sessionRecord.lifecycleVersion,
        ),
        ...buildActiveLifecycleUpdate(restoredState),
      });

      kickSandboxLifecycleWorkflow({
        sessionId,
        reason: "snapshot-restored",
      });

      const sandboxName = sessionRecord.sandboxState?.name;
      console.log(
        `[Snapshot Restore] session=${sessionId} success=true persistent=true name=${sandboxName}`,
      );

      return Response.json({
        success: true,
        restoredFrom: "persistent",
        sandboxName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[Snapshot Restore] session=${sessionId} success=false persistent=true error=${message}`,
      );
      return Response.json(
        { error: `Failed to resume persistent sandbox: ${message}` },
        { status: 500 },
      );
    }
  }

  // --- Legacy path: restore from snapshotUrl, lazy-migrate to persistent ---

  // If archive finalization is still running, return 409 until the background
  // task either stores a snapshot or clears runtime sandbox state after a
  // recoverable archive failure.
  if (!sessionRecord.snapshotUrl) {
    if (hasRuntimeSandboxState(sessionRecord.sandboxState)) {
      console.warn(
        `[Snapshot Restore] session=${sessionId} pending=true sandboxType=${sessionRecord.sandboxState?.type ?? "null"}`,
      );
      return Response.json(
        {
          error:
            "Snapshot is still being created. Please wait a few seconds and try again.",
        },
        { status: 409 },
      );
    }

    console.error(
      `[Snapshot Restore] session=${sessionId} error=no_snapshot sandboxType=${sessionRecord.sandboxState?.type ?? "null"}`,
    );
    return Response.json(
      { error: "No snapshot available for this session" },
      { status: 404 },
    );
  }
  if (!sessionRecord.sandboxState) {
    console.error(
      `[Snapshot Restore] session=${sessionId} error=no_sandbox_state hasSnapshot=true`,
    );
    return Response.json(
      { error: "No sandbox state available for restoration" },
      { status: 400 },
    );
  }
  if (sessionRecord.sandboxState.type !== "vercel") {
    return Response.json(
      {
        error:
          "Snapshot restoration is only supported for the current cloud sandbox provider",
      },
      { status: 400 },
    );
  }
  const sandboxType = sessionRecord.sandboxState.type;
  // Warn if sandbox appears to still be running (has sandboxId)
  // This shouldn't happen in normal flow since snapshot stops the sandbox
  if (canOperateOnSandbox(sessionRecord.sandboxState)) {
    console.log(
      `[Snapshot Restore] session=${sessionId} already_running=true sandboxType=${sandboxType}`,
    );
    return Response.json({
      success: true,
      alreadyRunning: true,
      restoredFrom: sessionRecord.snapshotUrl,
    });
  }

  try {
    // Lazy migration: create a new persistent sandbox from the snapshot,
    // naming it session_<id> so future operations use the persistent path.
    const sandboxName = `session_${sessionId}`;

    const sandbox = await connectSandbox(
      { type: sandboxType, snapshotId: sessionRecord.snapshotUrl },
      {
        name: sandboxName,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        ports: DEFAULT_SANDBOX_PORTS,
      },
    );

    // Update session with new persistent sandbox state.
    // getState() now returns { type, name, expiresAt }.
    const newState = sandbox.getState?.();
    const restoredState = (newState ?? {
      type: sandboxType,
      name: sandboxName,
    }) as Parameters<typeof updateSession>[1]["sandboxState"];

    await updateSession(sessionId, {
      sandboxState: restoredState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildActiveLifecycleUpdate(restoredState),
    });

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "snapshot-restored",
    });

    console.log(
      `[Snapshot Restore] session=${sessionId} success=true sandboxType=${sandboxType} name=${sandboxName} restoredFrom=${sessionRecord.snapshotUrl} migrated=true`,
    );

    return Response.json({
      success: true,
      restoredFrom: sessionRecord.snapshotUrl,
      sandboxName,
      migrated: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[Snapshot Restore] session=${sessionId} success=false error=${message}`,
    );
    return Response.json(
      { error: `Failed to restore snapshot: ${message}` },
      { status: 500 },
    );
  }
}
