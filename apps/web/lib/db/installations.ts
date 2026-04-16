import { and, asc, eq, inArray, notInArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type GitHubInstallation,
  githubInstallations,
  memberships,
  type NewGitHubInstallation,
} from "./schema";

export interface UpsertInstallationInput {
  /**
   * Owning tenant for this installation. Required going forward — all
   * installations are tenant-scoped. Pass the caller's personal tenant id
   * when an install happens outside of an active tenant context.
   */
  tenantId: string;
  /**
   * Legacy user id. Retained on the row for back-compat and so that
   * user-token-based GitHub API calls can still find the installer. New
   * code should treat {@link tenantId} as the source of truth.
   */
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl?: string | null;
}

export async function upsertInstallation(
  data: UpsertInstallationInput,
): Promise<GitHubInstallation> {
  const existing = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, data.userId),
        or(
          eq(githubInstallations.installationId, data.installationId),
          eq(githubInstallations.accountLogin, data.accountLogin),
        ),
      ),
    )
    .limit(1);

  const now = new Date();

  if (existing[0]) {
    const [updated] = await db
      .update(githubInstallations)
      .set({
        tenantId: data.tenantId,
        installationId: data.installationId,
        accountLogin: data.accountLogin,
        accountType: data.accountType,
        repositorySelection: data.repositorySelection,
        installationUrl: data.installationUrl ?? null,
        updatedAt: now,
      })
      .where(eq(githubInstallations.id, existing[0].id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update GitHub installation");
    }

    return updated;
  }

  const installation: NewGitHubInstallation = {
    id: nanoid(),
    tenantId: data.tenantId,
    userId: data.userId,
    installationId: data.installationId,
    accountLogin: data.accountLogin,
    accountType: data.accountType,
    repositorySelection: data.repositorySelection,
    installationUrl: data.installationUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db
    .insert(githubInstallations)
    .values(installation)
    .returning();

  if (!created) {
    throw new Error("Failed to create GitHub installation");
  }

  return created;
}

// ── Tenant-scoped lookups (preferred) ──────────────────────────────────────

/**
 * List all GitHub App installations owned by the given tenant. Tenant-scoped
 * callers should use this instead of {@link getInstallationsByUserId}.
 */
export async function listInstallationsForTenant(
  tenantId: string,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.tenantId, tenantId))
    .orderBy(asc(githubInstallations.accountLogin));
}

export async function getInstallationByTenant(
  tenantId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const [row] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.tenantId, tenantId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .limit(1);
  return row;
}

export async function getInstallationByTenantAndAccountLogin(
  tenantId: string,
  accountLogin: string,
): Promise<GitHubInstallation | undefined> {
  const [row] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.tenantId, tenantId),
        eq(githubInstallations.accountLogin, accountLogin),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Find the tenant(s) that own a GitHub App installation id. Used by the
 * webhook handler to route incoming events from GitHub back to the owning
 * tenant.
 */
export async function getTenantIdsForInstallationId(
  installationId: number,
): Promise<string[]> {
  const rows = await db
    .select({ tenantId: githubInstallations.tenantId })
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId));
  return rows
    .map((r) => r.tenantId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ── Legacy user-scoped lookups (deprecated) ────────────────────────────────

/**
 * @deprecated Use {@link listInstallationsForTenant}. Retained for call sites
 * that still resolve installations from a user id — typically anything that
 * only has a session user in scope. New code should derive a tenantId from
 * {@link import("./tenant-context").requireTenantCtx} and use the tenant-
 * scoped variants.
 *
 * TODO(tenancy): delete once all callers have migrated.
 */
export async function getInstallationsByUserId(
  userId: string,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .orderBy(asc(githubInstallations.accountLogin));
}

/**
 * Resolve installations for a user by following their tenant memberships.
 * This is the recommended bridge for legacy user-scoped call sites that are
 * being migrated to tenant-scoped access — it returns every installation
 * owned by any tenant the user belongs to.
 */
export async function getInstallationsForUserViaMemberships(
  userId: string,
): Promise<GitHubInstallation[]> {
  const tenantRows = await db
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const tenantIds = tenantRows.map((r) => r.tenantId);
  if (tenantIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(githubInstallations)
    .where(inArray(githubInstallations.tenantId, tenantIds))
    .orderBy(asc(githubInstallations.accountLogin));
}

/**
 * @deprecated Use {@link getInstallationByTenantAndAccountLogin}.
 */
export async function getInstallationByAccountLogin(
  userId: string,
  accountLogin: string,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.accountLogin, accountLogin),
      ),
    )
    .limit(1);

  return installation;
}

/**
 * @deprecated Use {@link getInstallationByTenant}.
 */
export async function getInstallationByUserAndId(
  userId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .limit(1);

  return installation;
}

export async function getInstallationsByInstallationId(
  installationId: number,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId));
}

export async function deleteInstallationByInstallationId(
  installationId: number,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

export async function deleteInstallationsByUserId(
  userId: string,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

export async function deleteInstallationsNotInList(
  userId: string,
  installationIds: number[],
): Promise<number> {
  if (installationIds.length === 0) {
    return deleteInstallationsByUserId(userId);
  }

  const deleted = await db
    .delete(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        notInArray(githubInstallations.installationId, installationIds),
      ),
    )
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

export async function updateInstallationsByInstallationId(
  installationId: number,
  updates: {
    accountLogin?: string;
    accountType?: "User" | "Organization";
    repositorySelection?: "all" | "selected";
    installationUrl?: string | null;
  },
): Promise<number> {
  if (
    updates.accountLogin === undefined &&
    updates.accountType === undefined &&
    updates.repositorySelection === undefined &&
    updates.installationUrl === undefined
  ) {
    return 0;
  }

  const updated = await db
    .update(githubInstallations)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return updated.length;
}
