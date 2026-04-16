import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

// Stub `server-only` so transitive imports (./billing) load under bun:test.
mock.module("server-only", () => ({}));

let rlModule: typeof import("./rate-limit");

const originalRedisUrl = process.env.REDIS_URL;
const originalKvUrl = process.env.KV_URL;

function clearRedisEnv(): void {
  delete process.env.REDIS_URL;
  delete process.env.KV_URL;
}

function restoreRedisEnv(): void {
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
  if (originalKvUrl === undefined) {
    delete process.env.KV_URL;
  } else {
    process.env.KV_URL = originalKvUrl;
  }
}

beforeAll(async () => {
  rlModule = await import("./rate-limit");
});

beforeEach(() => {
  rlModule.__resetRateLimitClientForTests();
});

afterAll(() => {
  restoreRedisEnv();
  rlModule.__resetRateLimitClientForTests();
});

// ---------------------------------------------------------------------------
// (b) Redis-not-configured returns allow-all. Runs FIRST so the static
//     `isRedisConfigured`/`createRedisClient` bindings inside rate-limit.ts
//     point at the real ./redis module.
// ---------------------------------------------------------------------------
describe("rateLimit (no redis configured)", () => {
  test("allows all requests when REDIS_URL/KV_URL are absent", async () => {
    clearRedisEnv();
    rlModule.__resetRateLimitClientForTests();

    const result = await rlModule.rateLimit("rl:tenant:t1:write", {
      rpm: 10,
      burst: 0,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(10);
    expect(result.resetMs).toBe(0);

    // Repeatedly past the cap is still allowed in no-redis mode.
    for (let i = 0; i < 5; i++) {
      const r = await rlModule.rateLimit("rl:tenant:t1:write", {
        rpm: 1,
        burst: 0,
      });
      expect(r.allowed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (a) 429 path returns headers / disallowed result with reset window.
//     We mock the ./redis module to hand out a stub client whose pipeline
//     reports a count over the limit, then dynamically re-import rate-limit
//     so its top-level imports resolve to the mocked module.
// ---------------------------------------------------------------------------
describe("rateLimit (429 path)", () => {
  test("returns disallowed result with reset window when count > limit", async () => {
    const oldestScore = Date.now() - 30_000;
    const pipelineExec = mock(async () => [
      [null, 0], // zremrangebyscore
      [null, 1], // zadd
      [null, 5], // zcard -> count
      [null, ["m", String(oldestScore)]], // zrange WITHSCORES
      [null, 1], // pexpire
    ]);
    const fakeClient = {
      pipeline: () => ({
        zremrangebyscore: () => undefined,
        zadd: () => undefined,
        zcard: () => undefined,
        zrange: () => undefined,
        pexpire: () => undefined,
        exec: pipelineExec,
      }),
      // The wrapper does `client.zrem(...).catch(...)` so return a promise.
      zrem: async () => 1,
    };

    mock.module("./redis", () => ({
      isRedisConfigured: () => true,
      createRedisClient: () => fakeClient,
      getRedisUrl: () => "redis://localhost:6379",
      getRedisConnectionOptions: () => ({}),
      warnRedisDisabled: () => undefined,
    }));

    // Dynamically re-import so the mocked redis is bound by rate-limit's
    // top-level imports.
    const mod = await import(`./rate-limit?bust-${Date.now()}`);
    mod.__resetRateLimitClientForTests();

    const result = await mod.rateLimit("rl:tenant:t1:write", {
      rpm: 2,
      burst: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(2);
    expect(result.resetMs).toBeGreaterThan(0);
    expect(pipelineExec).toHaveBeenCalled();

    // 429 response shape — `withRateLimit` derives these headers from the
    // RateLimitResult above.
    const headers = {
      "Retry-After": String(Math.ceil(result.resetMs / 1000) || 1),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
    };
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    expect(headers["X-RateLimit-Limit"]).toBe("2");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });
});
