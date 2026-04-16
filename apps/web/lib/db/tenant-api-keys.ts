import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantApiKeys } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import { decrypt, encrypt } from "@/lib/crypto";
import { scopedQuery } from "@/lib/db/tenant-guard";

/**
 * BYO model keys — tenant-scoped API key storage.
 *
 * Crypto caveat: keys are sealed with AES-256-CBC via `apps/web/lib/crypto.ts`.
 * CBC is usable but NOT AEAD — we plan to upgrade to AES-256-GCM (or libsodium
 * secretbox) and re-wrap existing ciphertexts. Until then, treat the
 * encryption-at-rest guarantee as "confidentiality" only, not "integrity".
 */

export type TenantApiKeyProvider =
  | "anthropic"
  | "openai"
  | "gateway"
  | "google"
  | "xai";

export type TenantApiKeyDTO = {
  id: string;
  tenantId: string;
  provider: TenantApiKeyProvider;
  label: string | null;
  keyHint: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export type ActiveKeyResolution = {
  id: string;
  provider: TenantApiKeyProvider;
  label: string | null;
  plaintext: string;
  keyHint: string;
};

let warnedOnceAboutCbc = false;
function warnCbcOnce() {
  if (warnedOnceAboutCbc) return;
  warnedOnceAboutCbc = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[tenant-api-keys] crypto.encrypt uses AES-256-CBC (not AEAD). " +
      "Pending upgrade to authenticated encryption (GCM).",
  );
}

function hintFromPlaintext(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••${tail || "????"}`;
}

function toDTO(row: typeof tenantApiKeys.$inferSelect): TenantApiKeyDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider as TenantApiKeyProvider,
    label: row.label,
    keyHint: row.keyHint,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Best-effort audit hook. The `apps/web/lib/audit.ts` module is being built
 * in parallel (wave 3B); we import lazily so the web build succeeds even if
 * the module hasn't landed yet.
 * TODO: drop the try/catch once audit.ts is merged.
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
    console.warn("[tenant-api-keys] audit hook failed (non-fatal)", err);
  }
}

export async function createKey(
  ctx: TenantContext,
  input: {
    provider: TenantApiKeyProvider;
    label?: string | null;
    plaintextKey: string;
    userId: string;
  },
): Promise<TenantApiKeyDTO> {
  warnCbcOnce();
  const plaintext = input.plaintextKey.trim();
  if (!plaintext) {
    throw new Error("plaintextKey is required");
  }

  const encrypted = encrypt(plaintext);
  const keyHint = hintFromPlaintext(plaintext);
  const id = randomUUID();

  const sq = scopedQuery(ctx);
  const inserted = (await (
    sq.insertInto(tenantApiKeys, {
      id,
      provider: input.provider,
      label: input.label ?? null,
      encryptedKey: encrypted,
      keyHint,
      createdByUserId: input.userId,
    }) as unknown as {
      returning: () => Promise<(typeof tenantApiKeys.$inferSelect)[]>;
    }
  ).returning()) as (typeof tenantApiKeys.$inferSelect)[];

  const row = inserted[0];
  if (!row) throw new Error("failed to insert tenant api key");

  await tryAudit(ctx, "apikey.created", row.id, { provider: row.provider });
  return toDTO(row);
}

export async function listKeys(ctx: TenantContext): Promise<TenantApiKeyDTO[]> {
  const rows = (await db
    .select()
    .from(tenantApiKeys)
    .where(
      and(
        eq(tenantApiKeys.tenantId, ctx.tenantId),
        isNull(tenantApiKeys.revokedAt),
      ),
    )
    .orderBy(desc(tenantApiKeys.createdAt))) as (typeof tenantApiKeys.$inferSelect)[];
  return rows.map(toDTO);
}

export async function revokeKey(
  ctx: TenantContext,
  id: string,
): Promise<TenantApiKeyDTO | null> {
  const now = new Date();
  const rows = (await db
    .update(tenantApiKeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(eq(tenantApiKeys.id, id), eq(tenantApiKeys.tenantId, ctx.tenantId)),
    )
    .returning()) as (typeof tenantApiKeys.$inferSelect)[];
  const row = rows[0];
  if (!row) return null;
  await tryAudit(ctx, "apikey.revoked", row.id, { provider: row.provider });
  return toDTO(row);
}

/**
 * Internal: returns the decrypted plaintext for the most recently created
 * active key for (tenant, provider). NEVER expose via API — callers must
 * be server-side only.
 */
export async function getActiveKey(
  ctx: Pick<TenantContext, "tenantId">,
  provider: TenantApiKeyProvider,
): Promise<ActiveKeyResolution | null> {
  warnCbcOnce();
  const rows = (await db
    .select()
    .from(tenantApiKeys)
    .where(
      and(
        eq(tenantApiKeys.tenantId, ctx.tenantId),
        eq(tenantApiKeys.provider, provider),
        isNull(tenantApiKeys.revokedAt),
      ),
    )
    .orderBy(desc(tenantApiKeys.createdAt))
    .limit(1)) as (typeof tenantApiKeys.$inferSelect)[];
  const row = rows[0];
  if (!row) return null;

  try {
    const plaintext = decrypt(row.encryptedKey);
    return {
      id: row.id,
      provider: row.provider as TenantApiKeyProvider,
      label: row.label,
      plaintext,
      keyHint: row.keyHint,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[tenant-api-keys] failed to decrypt key", {
      id: row.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
