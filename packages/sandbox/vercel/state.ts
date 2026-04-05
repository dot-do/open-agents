import type { Source } from "../types";

/**
 * State configuration for creating, reconnecting, or restoring the current cloud sandbox provider.
 * Used with the unified `connectSandbox()` API.
 *
 * With persistent sandboxes, `name` is the primary identifier. The SDK
 * automatically snapshots on stop and resumes on the next `Sandbox.get()`.
 *
 * Legacy fields (`sandboxId`, `snapshotId`) are kept for backward compatibility
 * during migration. New sessions should only use `name`.
 */
export interface VercelState {
  /** Persistent sandbox name (primary identifier for new sessions) */
  name?: string;
  /** Where to clone from (omit for empty sandbox or when reconnecting/restoring) */
  source?: Source;
  /** @deprecated Sandbox ID for reconnecting to a running VM — use `name` instead */
  sandboxId?: string;
  /** @deprecated Snapshot ID for restoring when VM timed out — persistent sandboxes handle this automatically */
  snapshotId?: string;
  /** Timestamp (ms) when the current sandbox VM session expires */
  expiresAt?: number;
}
