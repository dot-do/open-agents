import type { SandboxState } from "@open-harness/sandbox";
import { SANDBOX_EXPIRES_BUFFER_MS } from "./config";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Check if a sandbox state has a persistent name.
 * Persistent sandboxes auto-resume on command execution, so they are always
 * "reachable" even when the underlying VM session is stopped.
 */
export function isPersistentSandbox(
  state: SandboxState | null | undefined,
): boolean {
  if (!state) return false;
  return "name" in state && hasNonEmptyString(state.name);
}

/**
 * Type guard to check if a sandbox is active and ready to accept operations.
 *
 * For persistent sandboxes (has `name`): always active — the SDK auto-resumes.
 * For legacy sandboxes (has `sandboxId`): checks expiresAt to avoid sending
 * commands to an expired VM.
 */
export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;

  // Persistent sandboxes with a name are always "active" — auto-resume handles the rest
  if (isPersistentSandbox(state)) {
    return true;
  }

  // Legacy path: check expiry on non-persistent sandboxes
  if ("expiresAt" in state && state.expiresAt !== undefined) {
    if (Date.now() >= state.expiresAt - SANDBOX_EXPIRES_BUFFER_MS) {
      return false;
    }
  }

  return hasRuntimeState(state);
}

/**
 * Check if we can perform operations on a sandbox (snapshot, stop, etc.).
 *
 * For persistent sandboxes: always operable as long as `name` exists.
 * For legacy sandboxes: requires `sandboxId`.
 */
export function canOperateOnSandbox(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;
  if (isPersistentSandbox(state)) return true;
  return hasRuntimeState(state);
}

/**
 * Check if an unknown value represents sandbox state with runtime data.
 * Returns true if the state has a persistent `name` or a legacy `sandboxId`.
 */
export function hasRuntimeSandboxState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;

  const sandboxState = state as {
    name?: unknown;
    sandboxId?: unknown;
  };

  return (
    hasNonEmptyString(sandboxState.name) ||
    hasNonEmptyString(sandboxState.sandboxId)
  );
}

/**
 * Check if an error message indicates the sandbox VM is permanently unavailable.
 */
export function isSandboxUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("expected a stream of command data") ||
    normalized.includes("status code 410") ||
    normalized.includes("status code 404") ||
    normalized.includes("sandbox is stopped") ||
    normalized.includes("sandbox not found") ||
    normalized.includes("sandbox probe failed")
  );
}

function hasRuntimeState(state: SandboxState): boolean {
  return "sandboxId" in state && hasNonEmptyString(state.sandboxId);
}

/**
 * Clear sandbox runtime state while preserving identity for future restoration.
 *
 * For persistent sandboxes: keeps `name` (the stable identity) but clears
 * transient fields like `expiresAt`. The SDK auto-resumes on next access.
 *
 * For legacy sandboxes: clears everything except `type`.
 */
export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;

  // Persistent sandbox: preserve the name, clear transient state
  if (isPersistentSandbox(state)) {
    return { type: state.type, name: state.name } as SandboxState;
  }

  // Legacy: clear everything except type
  return { type: state.type } as SandboxState;
}
