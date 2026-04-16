/**
 * Cache key helpers for the multitenant fork.
 *
 * All Redis keys MUST go through one of these helpers so we can audit which
 * caches are tenant-scoped vs intentionally global. The default is
 * tenant-scoped: any per-user, per-session, per-chat, or per-resource cache
 * key MUST be wrapped in `tenantKey(tenantId, ...)` so that two tenants
 * cannot poison each other's cache (e.g., by colliding on a sessionId or
 * sandbox name in a fork that allows duplicate IDs across tenants).
 *
 * Use `globalKey(...)` ONLY for values that are provably tenant-agnostic:
 *
 *   1. Public/static metadata that ships with the app and is identical for
 *      every tenant (e.g., the model catalog, public skill registry blobs).
 *   2. Content-addressed values keyed by a strong hash of immutable inputs
 *      (e.g., `globalKey('blob', sha256)`) where the hash itself proves the
 *      value cannot leak tenant data.
 *   3. Process-wide infra concerns (lock counters, leader election) that
 *      have no tenant identity.
 *
 * If you're not sure, use `tenantKey`. A redundant tenant prefix on a global
 * value is a small efficiency loss; a missing tenant prefix on a tenant
 * value is a security bug.
 */

/** Throws if any segment is empty / nullish — empty parts collapse separators
 * and create accidental key collisions across resources. */
function assertNonEmpty(parts: readonly string[]): void {
  for (const part of parts) {
    if (typeof part !== "string" || part.length === 0) {
      throw new Error(
        `[cache-keys] empty segment in key: ${JSON.stringify(parts)}`,
      );
    }
  }
}

/**
 * Build a tenant-scoped Redis key. Always prefer this over hand-rolled keys.
 *
 *   tenantKey('t_abc', 'skills', 'v1', sessionId, sandboxScope)
 *   // -> 'tenant:t_abc:skills:v1:<sessionId>:<sandboxScope>'
 */
export function tenantKey(
  tenantId: string,
  ...parts: readonly string[]
): string {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("[cache-keys] tenantKey requires a non-empty tenantId");
  }
  assertNonEmpty(parts);
  return `tenant:${tenantId}:${parts.join(":")}`;
}

/**
 * Build a tenant-agnostic Redis key. Use ONLY for the cases enumerated in the
 * file header — model catalog, public skill metadata, content-addressed blobs,
 * process-wide infra. Document the justification at the call site.
 *
 *   globalKey('models', 'catalog', 'v3')
 *   // -> 'global:models:catalog:v3'
 */
export function globalKey(...parts: readonly string[]): string {
  assertNonEmpty(parts);
  return `global:${parts.join(":")}`;
}
