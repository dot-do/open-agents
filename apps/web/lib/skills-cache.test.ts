import { describe, expect, test } from "bun:test";
import type { SkillMetadata } from "@open-harness/agent";
import { createSkillsCache, getSkillsCacheKey } from "./skills-cache";

const exampleSkills: SkillMetadata[] = [
  {
    name: "ship",
    description: "Deploy the current project",
    path: "/workspace/.agents/skills/ship",
    filename: "SKILL.md",
    options: {},
  },
];

describe("skills cache", () => {
  test("derives tenant-scoped cache keys from sandbox name, legacy snapshot id, or local scope", () => {
    expect(
      getSkillsCacheKey("t_abc", "session-1", {
        type: "vercel",
        sandboxName: "session_session-1",
        snapshotId: "snap-123",
      }),
    ).toBe("tenant:t_abc:skills:v1:session-1:session_session-1");

    expect(
      getSkillsCacheKey("t_abc", "session-1", {
        type: "vercel",
        snapshotId: "snap-123",
      }),
    ).toBe("tenant:t_abc:skills:v1:session-1:snap-123");

    expect(
      getSkillsCacheKey("t_abc", "session-1", {
        type: "vercel",
      }),
    ).toBe("tenant:t_abc:skills:v1:session-1:local");
  });

  test("two tenants with the same sessionId get distinct cache keys", () => {
    const sandboxState = { type: "vercel" as const, sandboxName: "shared" };
    const a = getSkillsCacheKey("tenant-a", "session-shared", sandboxState);
    const b = getSkillsCacheKey("tenant-b", "session-shared", sandboxState);
    expect(a).not.toBe(b);
    expect(a.startsWith("tenant:tenant-a:")).toBe(true);
    expect(b.startsWith("tenant:tenant-b:")).toBe(true);
  });

  test("caches empty skill arrays in the in-memory fallback until TTL expires", async () => {
    let nowMs = 10_000;
    const cache = createSkillsCache({
      ttlSeconds: 1,
      now: () => nowMs,
      getRedisClient: () => null,
    });
    const sandboxState = { type: "vercel" as const };

    await cache.set("t_abc", "session-1", sandboxState, []);

    expect(await cache.get("t_abc", "session-1", sandboxState)).toEqual([]);

    nowMs += 999;
    expect(await cache.get("t_abc", "session-1", sandboxState)).toEqual([]);

    nowMs += 2;
    expect(await cache.get("t_abc", "session-1", sandboxState)).toBeNull();
  });

  test("cache writes by one tenant are not visible to another tenant for the same sessionId", async () => {
    const cache = createSkillsCache({
      ttlSeconds: 60,
      getRedisClient: () => null,
    });
    const sandboxState = { type: "vercel" as const };

    await cache.set("tenant-a", "session-1", sandboxState, exampleSkills);

    expect(await cache.get("tenant-a", "session-1", sandboxState)).toEqual(
      exampleSkills,
    );
    expect(await cache.get("tenant-b", "session-1", sandboxState)).toBeNull();
  });

  test("falls back to the in-memory cache when Redis reads fail", async () => {
    let redisAvailable = true;
    const loggerCalls: unknown[][] = [];
    const cache = createSkillsCache({
      getRedisClient: () =>
        redisAvailable
          ? {
              get: async () => {
                throw new Error("redis unavailable");
              },
              set: async () => "OK",
            }
          : null,
      logger: {
        error: (...args) => {
          loggerCalls.push(args);
        },
      },
    });
    const sandboxState = {
      type: "vercel" as const,
      sandboxName: "session_session-1",
    };

    await cache.set("t_abc", "session-1", sandboxState, exampleSkills);
    expect(await cache.get("t_abc", "session-1", sandboxState)).toEqual(
      exampleSkills,
    );
    expect(loggerCalls).toHaveLength(1);
  });
});
