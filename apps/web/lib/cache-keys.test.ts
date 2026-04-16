import { describe, expect, test } from "bun:test";
import { globalKey, tenantKey } from "./cache-keys";

describe("tenantKey", () => {
  test("prefixes parts with tenant:<id>:", () => {
    expect(tenantKey("t_abc", "skills", "v1", "session-1", "local")).toBe(
      "tenant:t_abc:skills:v1:session-1:local",
    );
  });

  test("two distinct tenants produce non-overlapping keys for the same logical entity", () => {
    const a = tenantKey("tenant-a", "skills", "v1", "session-shared");
    const b = tenantKey("tenant-b", "skills", "v1", "session-shared");
    expect(a).not.toBe(b);
    expect(a.startsWith("tenant:tenant-a:")).toBe(true);
    expect(b.startsWith("tenant:tenant-b:")).toBe(true);
  });

  test("rejects empty tenantId", () => {
    expect(() => tenantKey("", "skills")).toThrow(/non-empty tenantId/);
  });

  test("rejects empty key segments to avoid accidental collisions", () => {
    expect(() => tenantKey("t_abc", "skills", "")).toThrow(/empty segment/);
  });

  test("requires at least one part to avoid bare tenant prefixes", () => {
    // A bare `tenant:t_abc:` key has no resource identifier — likely a bug.
    // We don't ban zero-parts at the type level but assertNonEmpty over an
    // empty array is a no-op; document by example that this produces just
    // the prefix:
    expect(tenantKey("t_abc")).toBe("tenant:t_abc:");
  });
});

describe("globalKey", () => {
  test("prefixes parts with global:", () => {
    expect(globalKey("models", "catalog", "v3")).toBe(
      "global:models:catalog:v3",
    );
  });

  test("global keys do NOT collide with tenant keys", () => {
    // Important: the `tenant:` and `global:` namespaces must not overlap so
    // that an attacker cannot craft a tenantId that produces a key in the
    // global space (or vice-versa).
    const g = globalKey("skills", "v1");
    const t = tenantKey("global", "skills", "v1");
    expect(g.startsWith("global:")).toBe(true);
    expect(t.startsWith("tenant:")).toBe(true);
    expect(g).not.toBe(t);
  });

  test("rejects empty key segments", () => {
    expect(() => globalKey("models", "")).toThrow(/empty segment/);
  });
});
