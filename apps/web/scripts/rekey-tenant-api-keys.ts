#!/usr/bin/env bun
/**
 * Rekey tenant_api_keys from legacy AES-256-CBC to AES-256-GCM (v2).
 *
 * Streams rows, skips anything already prefixed `v2:`, decrypts the legacy
 * ciphertext via `decryptCbcLegacy`, re-encrypts with `encrypt()` (GCM) and
 * binds AAD = `tenant:{tenantId}|provider:{provider}`. UPDATEs in place.
 *
 * Usage:  bun run rekey:tenant-keys  [--dry-run]
 *
 * Idempotent: safe to re-run. A row already in v2 format is a no-op.
 */

import { eq } from "drizzle-orm";
import { db } from "../lib/db/client";
import { tenantApiKeys } from "../lib/db/schema";
import { decryptCbcLegacy, encrypt } from "../lib/crypto";

const DRY_RUN = process.argv.includes("--dry-run");
const V2_PREFIX = "v2:";

type Row = typeof tenantApiKeys.$inferSelect;

async function main() {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY must be set to run rekey");
  }

  const rows = (await db.select().from(tenantApiKeys)) as Row[];
  let scanned = 0;
  let skipped = 0;
  let rekeyed = 0;
  let failed = 0;

  for (const row of rows) {
    scanned++;
    if (!row.encryptedKey) {
      skipped++;
      continue;
    }
    if (row.encryptedKey.startsWith(V2_PREFIX)) {
      skipped++;
      continue;
    }
    try {
      const plaintext = decryptCbcLegacy(row.encryptedKey);
      const aad = `tenant:${row.tenantId}|provider:${row.provider}`;
      const v2 = encrypt(plaintext, aad);
      if (DRY_RUN) {
        // eslint-disable-next-line no-console
        console.log(`[dry-run] would rekey ${row.id} (${row.provider})`);
      } else {
        await db
          .update(tenantApiKeys)
          .set({ encryptedKey: v2, updatedAt: new Date() })
          .where(eq(tenantApiKeys.id, row.id));
      }
      rekeyed++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[rekey] FAILED id=${row.id} tenant=${row.tenantId} provider=${row.provider}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { scanned, skipped, rekeyed, failed, dryRun: DRY_RUN },
      null,
      2,
    ),
  );
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
