import { beforeAll, describe, expect, test } from "bun:test";
import crypto from "crypto";

// Set a deterministic 32-byte hex key before importing the module under test.
const TEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.ENCRYPTION_KEY = TEST_KEY;

import {
  decrypt,
  decryptCbcLegacy,
  decryptGcm,
  encrypt,
  encryptGcm,
} from "./crypto";

function makeLegacyCbc(plaintext: string): string {
  const key = Buffer.from(TEST_KEY, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

describe("crypto — AES-GCM (v2) roundtrip", () => {
  test("encrypt() emits v2 prefix and decrypt() roundtrips", () => {
    const ct = encrypt("hello world");
    expect(ct.startsWith("v2:")).toBe(true);
    expect(decrypt(ct)).toBe("hello world");
  });

  test("encryptGcm/decryptGcm roundtrip with AAD", () => {
    const ct = encryptGcm("secret-key-abc", "tenant:t1|provider:openai");
    expect(ct.startsWith("v2:")).toBe(true);
    expect(decryptGcm(ct, "tenant:t1|provider:openai")).toBe("secret-key-abc");
  });

  test("two encrypts of the same plaintext differ (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  test("empty string short-circuits", () => {
    expect(encrypt("")).toBe("");
    expect(decrypt("")).toBe("");
  });
});

describe("crypto — AAD binding", () => {
  test("mismatched AAD fails to decrypt", () => {
    const ct = encrypt("sk-live", "tenant:t1|provider:openai");
    expect(() => decrypt(ct, "tenant:t2|provider:openai")).toThrow();
  });

  test("missing AAD on a ciphertext sealed with AAD fails", () => {
    const ct = encrypt("sk-live", "tenant:t1|provider:openai");
    expect(() => decrypt(ct)).toThrow();
  });

  test("matching AAD succeeds", () => {
    const aad = "tenant:t1|provider:anthropic";
    const ct = encrypt("sk-ant-xxx", aad);
    expect(decrypt(ct, aad)).toBe("sk-ant-xxx");
  });

  test("tampered ciphertext is rejected by auth tag", () => {
    const ct = encrypt("payload", "aad");
    // flip a byte in the base64 body
    const body = ct.slice(3);
    const buf = Buffer.from(body, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const bad = `v2:${buf.toString("base64")}`;
    expect(() => decrypt(bad, "aad")).toThrow();
  });
});

describe("crypto — legacy CBC fallback", () => {
  test("decryptCbcLegacy reads raw CBC ciphertext", () => {
    const legacy = makeLegacyCbc("legacy-key");
    expect(decryptCbcLegacy(legacy)).toBe("legacy-key");
  });

  test("unified decrypt() dispatches non-v2 to legacy CBC", () => {
    const legacy = makeLegacyCbc("legacy-key-2");
    expect(decrypt(legacy)).toBe("legacy-key-2");
  });

  test("AAD is ignored on legacy path", () => {
    const legacy = makeLegacyCbc("legacy-ignored-aad");
    expect(decrypt(legacy, "whatever")).toBe("legacy-ignored-aad");
  });
});

describe("crypto — versioned prefix switching", () => {
  test("v2 ciphertext is NOT treated as legacy", () => {
    const v2 = encrypt("abc");
    expect(v2.startsWith("v2:")).toBe(true);
    // decryptCbcLegacy on v2 should fail (not a CBC hex envelope)
    expect(() => decryptCbcLegacy(v2)).toThrow();
  });

  test("decryptGcm rejects non-v2 input", () => {
    const legacy = makeLegacyCbc("x");
    expect(() => decryptGcm(legacy)).toThrow();
  });

  test("after rekey, v2 ciphertext roundtrips through unified decrypt", () => {
    const legacy = makeLegacyCbc("to-rekey");
    const plaintext = decryptCbcLegacy(legacy);
    const rekeyed = encrypt(plaintext, "tenant:t1|provider:openai");
    expect(rekeyed.startsWith("v2:")).toBe(true);
    expect(decrypt(rekeyed, "tenant:t1|provider:openai")).toBe("to-rekey");
  });
});

describe("crypto — key validation", () => {
  beforeAll(() => {
    // ensure key is still the valid one for following tests
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  test("invalid ENCRYPTION_KEY length throws on use", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "deadbeef";
    try {
      expect(() => encrypt("x")).toThrow(/32-byte hex/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});
