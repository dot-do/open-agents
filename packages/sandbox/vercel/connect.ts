import type { Sandbox, SandboxHooks } from "../interface";
import { VercelSandbox } from "./sandbox";
import type { VercelState } from "./state";
import { configureGitUser } from "./utils";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
  skipGitWorkspaceBootstrap?: boolean;
  /**
   * Persistent sandbox name to use when creating a new sandbox.
   * For existing persistent sandboxes, the name comes from VercelState.
   */
  name?: string;
}

function getRemainingTimeout(
  expiresAt: number | undefined,
): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const remaining = expiresAt - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

/**
 * Connect to the Vercel-backed cloud sandbox based on the provided state.
 *
 * Routing logic (in priority order):
 *
 * 1. Has `name` → `Sandbox.get({ name })` — persistent sandbox, auto-resumes if stopped
 * 2. Has `sandboxId` (no name) → `Sandbox.get({ name: sandboxId })` — legacy backfill compat
 * 3. Has `snapshotId` (no name/sandboxId) → Create new persistent sandbox from snapshot
 * 4. Has `source` → Create new persistent sandbox from git source
 * 5. Otherwise → Create empty persistent sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  // --- Persistent sandbox path: has a name ---
  // The SDK auto-resumes stopped persistent sandboxes on command execution.
  if (state.name) {
    const remainingTimeout = getRemainingTimeout(state.expiresAt);

    const sandbox = await VercelSandbox.connect(state.name, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout,
      ports: options?.ports,
    });

    return sandbox;
  }

  // --- Legacy path: has sandboxId but no name ---
  // The beta SDK backfills old sandbox IDs as names, so we can use sandboxId as the name.
  if (state.sandboxId) {
    const remainingTimeout = getRemainingTimeout(state.expiresAt);

    const sandbox = await VercelSandbox.connect(state.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout,
      ports: options?.ports,
    });

    return sandbox;
  }

  // --- Legacy restore path: has snapshotId but no name/sandboxId ---
  // Lazy migration: create a new persistent sandbox from the snapshot.
  // The caller should provide options.name (e.g., `session_${sessionId}`) so
  // the new sandbox gets a persistent name for future access.
  if (state.snapshotId) {
    const sandbox = await VercelSandbox.create({
      name: options?.name,
      baseSnapshotId: state.snapshotId,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
      env: options?.env,
      hooks: options?.hooks,
    });

    // Configure git user if provided (not done automatically when restoring from snapshot)
    if (options?.gitUser) {
      await configureGitUser(sandbox, options.gitUser);
    }

    return sandbox;
  }

  // --- Create from source ---
  if (state.source) {
    return VercelSandbox.create({
      name: options?.name,
      source: {
        url: state.source.repo,
        branch: state.source.branch,
        token: state.source.token,
        newBranch: state.source.newBranch,
      },
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
      ...(options?.baseSnapshotId && {
        baseSnapshotId: options.baseSnapshotId,
      }),
      ...(options?.skipGitWorkspaceBootstrap && {
        skipGitWorkspaceBootstrap: true,
      }),
    });
  }

  // --- Create empty sandbox ---
  return VercelSandbox.create({
    name: options?.name,
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.ports && { ports: options.ports }),
    ...(options?.baseSnapshotId && {
      baseSnapshotId: options.baseSnapshotId,
    }),
    ...(options?.skipGitWorkspaceBootstrap && {
      skipGitWorkspaceBootstrap: true,
    }),
  });
}
