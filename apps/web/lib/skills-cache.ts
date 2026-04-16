import type { SkillMetadata, SkillOptions } from "@open-harness/agent";
import type { SandboxState } from "@open-harness/sandbox";
import { tenantKey } from "./cache-keys";
import { createRedisClient, isRedisConfigured } from "./redis";

/**
 * Skills cache.
 *
 * Multitenancy: skill discovery results are PER-SESSION (and per-sandbox
 * scope), but session IDs are not provably unique across tenants in this
 * fork — a tenant could theoretically craft or guess another tenant's
 * sessionId and pollute its cached skill list (which is then surfaced to
 * the model and to the UI). To prevent that, every cache key is wrapped in
 * `tenantKey(tenantId, ...)` so two tenants share the Redis instance but
 * never the same key space.
 *
 * The cache is short-lived (4h TTL) and self-heals on miss, so we do not
 * migrate any pre-existing un-prefixed keys — they will simply expire.
 */
const SKILLS_CACHE_NAMESPACE = "skills:v1";
export const SKILLS_CACHE_TTL_SECONDS = 4 * 60 * 60;

type SkillsCacheEntry = {
  skills: SkillMetadata[];
  expiresAt: number;
};

type SkillsCacheRedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
};

type CreateSkillsCacheOptions = {
  ttlSeconds?: number;
  now?: () => number;
  getRedisClient?: () => SkillsCacheRedisClient | null;
  logger?: Pick<Console, "error">;
};

export type SkillsCache = ReturnType<typeof createSkillsCache>;

let sharedRedisClient: SkillsCacheRedisClient | null | undefined;

function getSharedRedisClient(): SkillsCacheRedisClient | null {
  if (sharedRedisClient !== undefined) {
    return sharedRedisClient;
  }

  if (!isRedisConfigured()) {
    sharedRedisClient = null;
    return sharedRedisClient;
  }

  sharedRedisClient = createRedisClient("skills-cache");
  return sharedRedisClient;
}

function getSandboxScope(state: SandboxState | null | undefined): string {
  if (state && "sandboxName" in state) {
    const sandboxName = state.sandboxName;
    if (typeof sandboxName === "string" && sandboxName.length > 0) {
      return sandboxName;
    }
  }

  if (state && "snapshotId" in state) {
    const snapshotId = state.snapshotId;
    if (typeof snapshotId === "string" && snapshotId.length > 0) {
      return snapshotId;
    }
  }

  return "local";
}

export function getSkillsCacheKey(
  tenantId: string,
  sessionId: string,
  sandboxState: SandboxState | null | undefined,
): string {
  return tenantKey(
    tenantId,
    SKILLS_CACHE_NAMESPACE,
    sessionId,
    getSandboxScope(sandboxState),
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isSkillOptions(value: unknown): value is SkillOptions {
  if (!value || typeof value !== "object") {
    return false;
  }

  const options = value as {
    disableModelInvocation?: unknown;
    userInvocable?: unknown;
    allowedTools?: unknown;
    context?: unknown;
    agent?: unknown;
  };

  if (
    options.disableModelInvocation !== undefined &&
    typeof options.disableModelInvocation !== "boolean"
  ) {
    return false;
  }

  if (
    options.userInvocable !== undefined &&
    typeof options.userInvocable !== "boolean"
  ) {
    return false;
  }

  if (
    options.allowedTools !== undefined &&
    !isStringArray(options.allowedTools)
  ) {
    return false;
  }

  if (options.context !== undefined && options.context !== "fork") {
    return false;
  }

  if (options.agent !== undefined && typeof options.agent !== "string") {
    return false;
  }

  return true;
}

function isSkillMetadata(value: unknown): value is SkillMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const skill = value as {
    name?: unknown;
    description?: unknown;
    path?: unknown;
    filename?: unknown;
    options?: unknown;
  };

  return (
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.path === "string" &&
    typeof skill.filename === "string" &&
    isSkillOptions(skill.options)
  );
}

function parseCachedSkills(value: string): SkillMetadata[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every((skill) => isSkillMetadata(skill))
  ) {
    return null;
  }

  return parsed;
}

export function createSkillsCache(options?: CreateSkillsCacheOptions) {
  const ttlSeconds = options?.ttlSeconds ?? SKILLS_CACHE_TTL_SECONDS;
  const now = options?.now ?? Date.now;
  const getRedisClient = options?.getRedisClient ?? getSharedRedisClient;
  const logger = options?.logger ?? console;
  const memoryCache = new Map<string, SkillsCacheEntry>();

  const pruneExpiredMemoryEntries = (currentTime: number) => {
    for (const [key, entry] of memoryCache) {
      if (entry.expiresAt <= currentTime) {
        memoryCache.delete(key);
      }
    }
  };

  const readFromMemory = (
    key: string,
    currentTime: number,
  ): SkillMetadata[] | null => {
    pruneExpiredMemoryEntries(currentTime);
    const cached = memoryCache.get(key);
    if (!cached || cached.expiresAt <= currentTime) {
      if (cached) {
        memoryCache.delete(key);
      }
      return null;
    }

    return cached.skills;
  };

  const writeToMemory = (
    key: string,
    skills: SkillMetadata[],
    currentTime: number,
  ) => {
    memoryCache.set(key, {
      skills,
      expiresAt: currentTime + ttlSeconds * 1000,
    });
  };

  return {
    getKey(
      tenantId: string,
      sessionId: string,
      sandboxState: SandboxState | null | undefined,
    ) {
      return getSkillsCacheKey(tenantId, sessionId, sandboxState);
    },

    async get(
      tenantId: string,
      sessionId: string,
      sandboxState: SandboxState | null | undefined,
    ): Promise<SkillMetadata[] | null> {
      const currentTime = now();
      const key = getSkillsCacheKey(tenantId, sessionId, sandboxState);
      const redisClient = getRedisClient();

      if (!redisClient) {
        return readFromMemory(key, currentTime);
      }

      try {
        const cachedValue = await redisClient.get(key);
        if (cachedValue === null) {
          return null;
        }

        const parsedSkills = parseCachedSkills(cachedValue);
        if (parsedSkills === null) {
          logger.error(`[skills-cache] Invalid cache payload for key ${key}.`);
          return readFromMemory(key, currentTime);
        }

        writeToMemory(key, parsedSkills, currentTime);
        return parsedSkills;
      } catch (error) {
        logger.error(
          `[skills-cache] Failed to read cache for key ${key}:`,
          error,
        );
        return readFromMemory(key, currentTime);
      }
    },

    async set(
      tenantId: string,
      sessionId: string,
      sandboxState: SandboxState | null | undefined,
      skills: SkillMetadata[],
    ): Promise<void> {
      const currentTime = now();
      const key = getSkillsCacheKey(tenantId, sessionId, sandboxState);
      writeToMemory(key, skills, currentTime);

      const redisClient = getRedisClient();
      if (!redisClient) {
        return;
      }

      try {
        await redisClient.set(key, JSON.stringify(skills), "EX", ttlSeconds);
      } catch (error) {
        logger.error(
          `[skills-cache] Failed to write cache for key ${key}:`,
          error,
        );
      }
    },
  };
}

const sharedSkillsCache = createSkillsCache();

export async function getCachedSkills(
  tenantId: string,
  sessionId: string,
  sandboxState: SandboxState | null | undefined,
): Promise<SkillMetadata[] | null> {
  return sharedSkillsCache.get(tenantId, sessionId, sandboxState);
}

export async function setCachedSkills(
  tenantId: string,
  sessionId: string,
  sandboxState: SandboxState | null | undefined,
  skills: SkillMetadata[],
): Promise<void> {
  await sharedSkillsCache.set(tenantId, sessionId, sandboxState, skills);
}
