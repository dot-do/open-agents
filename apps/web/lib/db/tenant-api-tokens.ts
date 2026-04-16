import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { tenantApiTokens } from "@/lib/db/schema";
import { scopedQuery } from "@/lib/db/tenant-guard";
import type { TenantContext } from "@/lib/db/tenant-context";

/**
 * Tenant-scoped Personal Access Tokens (PATs) for programmatic clients.
 *
 * Plaintext format: `oa_pat_<base64url(32)>` — easy to grep for if leaked.
 * The plaintext is shown ONCE at creation; only the sha256 hash is persisted.
 * `tokenHint` stores the trailing 4 chars of the plaintext for UI confirmation.
 *
 * Schema lives in `apps/web/lib/db/schema.ts#tenantApiTokens` and was created
 * by migration 0036. Feature logic intentionally lives in this file (per the
 * schema comment) so service code never imports schema-only fields.
 */

export type TokenScope = "read" | "write" | "admin";

const SCOPE_RANK: Record<TokenScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export type TenantApiTokenDTO = {
  id: string;
  tenantId: string;
  name: string;
  scope: TokenScope;
  tokenHint: string;
  createdByUserId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type CreateTokenResult = {
  id: string;
  token: string;
  hint: string;
  scope: TokenScope;
  expiresAt: Date | null;
};

export type TokenLookup = {
  tokenId: string;
  tenantId: string;
  scope: TokenScope;
  userId: string;
};

const TOKEN_PREFIX = "oa_pat_";

function toDTO(row: typeof tenantApiTokens.$inferSelect): TenantApiTokenDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    scope: row.scope as TokenScope,
    tokenHint: row.tokenHint,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function hintFromPlaintext(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••${tail || "????"}`;
}

function generatePlaintext(): string {
  // 32 random bytes => ~43 base64url chars; total length ~50 incl. prefix.
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function looksLikePat(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(TOKEN_PREFIX);
}

export function compareScope(actual: TokenScope, min: TokenScope): boolean {
  return SCOPE_RANK[actual] >= SCOPE_RANK[min];
}

/**
 * Best-effort audit hook. Lazy-loaded so a missing audit module never blocks
 * token creation; mirrors the pattern used by tenant-api-keys.ts.
 */
async function tryAudit(
  ctx: TenantContext,
  action: "apikey.created" | "apikey.revoked",
  target: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const mod = (await import("@/lib/audit").catch(() => null)) as
      | {
          audit?: (
            c: TenantContext,
            a: string,
            opts: { target: string; metadata?: Record<string, unknown> },
          ) => Promise<void> | void;
        }
      | null;
    if (mod?.audit) {
      await mod.audit(ctx, action, { target, metadata });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[tenant-api-tokens] audit hook failed (non-fatal)", err);
  }
}

export async function createToken(
  ctx: TenantContext,
  input: {
    name: string;
    scope: TokenScope;
    expiresInDays?: number | null;
  },
): Promise<CreateTokenResult> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("name is required");
  }
  if (!SCOPE_RANK[input.scope]) {
    throw new Error("invalid scope");
  }

  const plaintext = generatePlaintext();
  const tokenHash = hashToken(plaintext);
  const tokenHint = hintFromPlaintext(plaintext);
  const id = nanoid();
  const expiresAt =
    typeof input.expiresInDays === "number" && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const sq = scopedQuery(ctx);
  const inserted = (await (
    sq.insertInto(tenantApiTokens, {
      id,
      name,
      tokenHash,
      tokenHint,
      scope: input.scope,
      createdByUserId: ctx.userId,
      expiresAt,
    }) as unknown as {
      returning: () => Promise<(typeof tenantApiTokens.$inferSelect)[]>;
    }
  ).returning()) as (typeof tenantApiTokens.$inferSelect)[];

  const row = inserted[0];
  if (!row) throw new Error("failed to insert tenant api token");

  await tryAudit(ctx, "apikey.created", row.id, {
    kind: "pat",
    scope: row.scope,
    name: row.name,
  });

  return {
    id: row.id,
    token: plaintext,
    hint: row.tokenHint,
    scope: row.scope as TokenScope,
    expiresAt: row.expiresAt,
  };
}

export async function listTokens(
  ctx: TenantContext,
): Promise<TenantApiTokenDTO[]> {
  const rows = (await db
    .select()
    .from(tenantApiTokens)
    .where(
      and(
        eq(tenantApiTokens.tenantId, ctx.tenantId),
        isNull(tenantApiTokens.revokedAt),
      ),
    )
    .orderBy(desc(tenantApiTokens.createdAt))) as (typeof tenantApiTokens.$inferSelect)[];
  return rows.map(toDTO);
}

export async function revokeToken(
  ctx: TenantContext,
  id: string,
): Promise<TenantApiTokenDTO | null> {
  const now = new Date();
  const rows = (await db
    .update(tenantApiTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(tenantApiTokens.id, id),
        eq(tenantApiTokens.tenantId, ctx.tenantId),
      ),
    )
    .returning()) as (typeof tenantApiTokens.$inferSelect)[];
  const row = rows[0];
  if (!row) return null;
  await tryAudit(ctx, "apikey.revoked", row.id, {
    kind: "pat",
    scope: row.scope,
  });
  return toDTO(row);
}

/**
 * Resolve a plaintext PAT to its tenant context. Returns null if the token
 * is unknown, revoked, or expired. On a successful hit we update
 * `lastUsedAt` asynchronously (fire-and-forget) so the auth path stays cheap.
 */
export async function lookupTokenByPlaintext(
  plaintext: string,
): Promise<TokenLookup | null> {
  if (!looksLikePat(plaintext)) return null;
  const tokenHash = hashToken(plaintext);

  const rows = (await db
    .select()
    .from(tenantApiTokens)
    .where(eq(tenantApiTokens.tokenHash, tokenHash))
    .limit(1)) as (typeof tenantApiTokens.$inferSelect)[];
  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  // Fire-and-forget last-used touch. Errors are swallowed so a hot-path
  // database hiccup never breaks an authenticated request.
  void db
    .update(tenantApiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(tenantApiTokens.id, row.id))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[tenant-api-tokens] lastUsedAt touch failed", err);
    });

  return {
    tokenId: row.id,
    tenantId: row.tenantId,
    scope: row.scope as TokenScope,
    userId: row.createdByUserId,
  };
}
