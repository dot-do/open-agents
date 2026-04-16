import {
  getInstallationByTenant,
  getInstallationByTenantAndAccountLogin,
  listInstallationsForTenant,
} from "@/lib/db/installations";
import type { GitHubInstallation } from "@/lib/db/schema";

/**
 * Resolve the GitHub App installation that the given tenant should use to
 * operate on a specific repository owner.
 *
 * Every code path that clones, pushes, or creates pull requests against a
 * repository MUST resolve an installation through this helper so that the
 * correct tenant-scoped access is used. Call sites that do not supply a
 * tenantId will throw — this is intentional: we would rather fail loudly
 * than fall back to a user-scoped installation that may belong to a
 * different tenant.
 */
export async function requireTenantInstallationForOwner(params: {
  tenantId: string;
  owner: string;
}): Promise<GitHubInstallation> {
  const { tenantId, owner } = params;
  if (!tenantId) {
    throw new Error(
      "requireTenantInstallationForOwner: tenantId is required — the caller must thread a TenantContext through to this git operation.",
    );
  }

  const byLogin = await getInstallationByTenantAndAccountLogin(tenantId, owner);
  if (byLogin) {
    return byLogin;
  }

  throw new Error(
    `No GitHub App installation found for tenant ${tenantId} on owner "${owner}". The tenant must install the GitHub App on this account before repository operations are permitted.`,
  );
}

export async function requireTenantInstallationById(params: {
  tenantId: string;
  installationId: number;
}): Promise<GitHubInstallation> {
  const { tenantId, installationId } = params;
  if (!tenantId) {
    throw new Error(
      "requireTenantInstallationById: tenantId is required.",
    );
  }
  const row = await getInstallationByTenant(tenantId, installationId);
  if (!row) {
    throw new Error(
      `Installation ${installationId} is not accessible to tenant ${tenantId}.`,
    );
  }
  return row;
}

export async function listTenantInstallations(
  tenantId: string,
): Promise<GitHubInstallation[]> {
  if (!tenantId) {
    throw new Error("listTenantInstallations: tenantId is required.");
  }
  return listInstallationsForTenant(tenantId);
}
