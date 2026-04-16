import crypto from "crypto";

/**
 * At-rest encryption helpers.
 *
 * Envelope format:
 *   - v2 (current):  `v2:<base64(iv(12) | ciphertext | tag(16))>`  — AES-256-GCM (AEAD)
 *   - legacy (v1):   `<ivHex>:<ciphertextHex>`                      — AES-256-CBC
 *
 * `encrypt()` always emits v2. `decrypt()` peeks the prefix and dispatches.
 * The CBC path is retained only to read legacy rows; a rekey migration
 * (scripts/rekey-tenant-api-keys.ts) rewraps them in place.
 */

const CBC_ALGORITHM = "aes-256-cbc";
const GCM_ALGORITHM = "aes-256-gcm";
const CBC_IV_LENGTH = 16;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const V2_PREFIX = "v2:";

const getEncryptionKey = (): Buffer | null => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be a 32-byte hex string (64 characters)",
    );
  }
  return keyBuffer;
};

const requireKey = (): Buffer => {
  const k = getEncryptionKey();
  if (!k) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }
  return k;
};

export const encryptGcm = (plaintext: string, aad?: string): string => {
  if (!plaintext) return plaintext;
  const key = requireKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ciphertext, tag]);
  return `${V2_PREFIX}${payload.toString("base64")}`;
};

export const decryptGcm = (
  versionedCiphertext: string,
  aad?: string,
): string => {
  if (!versionedCiphertext) return versionedCiphertext;
  if (!versionedCiphertext.startsWith(V2_PREFIX)) {
    throw new Error("decryptGcm: missing v2 prefix");
  }
  const key = requireKey();
  const payload = Buffer.from(
    versionedCiphertext.slice(V2_PREFIX.length),
    "base64",
  );
  if (payload.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) {
    throw new Error("decryptGcm: payload too short");
  }
  const iv = payload.subarray(0, GCM_IV_LENGTH);
  const tag = payload.subarray(payload.length - GCM_TAG_LENGTH);
  const ciphertext = payload.subarray(
    GCM_IV_LENGTH,
    payload.length - GCM_TAG_LENGTH,
  );
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return out.toString("utf8");
};

let warnedCbcLegacyOnce = false;
const logCbcLegacyOnce = () => {
  if (warnedCbcLegacyOnce) return;
  warnedCbcLegacyOnce = true;
  // eslint-disable-next-line no-console
  console.warn(
    "crypto.cbc_read_legacy: reading legacy AES-256-CBC ciphertext; run rekey:tenant-keys to upgrade.",
  );
};

export const decryptCbcLegacy = (encryptedText: string): string => {
  if (!encryptedText) return encryptedText;
  const key = requireKey();
  if (!encryptedText.includes(":")) {
    throw new Error("Invalid encrypted text format");
  }
  const [ivHex, encryptedHex] = encryptedText.split(":");
  if (!ivHex || !encryptedHex) {
    throw new Error("Invalid encrypted text format");
  }
  const iv = Buffer.from(ivHex, "hex");
  if (iv.length !== CBC_IV_LENGTH) {
    throw new Error("Invalid CBC IV length");
  }
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv(CBC_ALGORITHM, key, iv);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

/**
 * Unified encrypt. Always emits v2 (GCM). `aad`, when provided, binds the
 * ciphertext to a logical slot (e.g. "tenant:t1|provider:openai"); the same
 * aad must be supplied to decrypt.
 */
export const encrypt = (plaintext: string, aad?: string): string => {
  if (!plaintext) return plaintext;
  return encryptGcm(plaintext, aad);
};

/**
 * Unified decrypt. Peeks the prefix: `v2:` dispatches to GCM; anything else
 * is treated as legacy CBC (logged once per process).
 *
 * AAD is only meaningful for v2 payloads; it is ignored on the legacy path.
 */
export const decrypt = (ciphertext: string, aad?: string): string => {
  if (!ciphertext) return ciphertext;
  if (ciphertext.startsWith(V2_PREFIX)) {
    return decryptGcm(ciphertext, aad);
  }
  logCbcLegacyOnce();
  return decryptCbcLegacy(ciphertext);
};
