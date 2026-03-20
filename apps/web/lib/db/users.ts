import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { users } from "./schema";

const userSelection = {
  id: users.id,
  provider: users.provider,
  username: users.username,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

export const LOCAL_AGENT_AUTH_USER_ID = "agent-user";
const LOCAL_AGENT_AUTH_EXTERNAL_ID = "local-agent-user";

type UserRecord = {
  id: string;
  provider: "github" | "vercel";
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Check if a user exists in the database by ID.
 * Returns true if found, false otherwise. Lightweight query (only fetches the ID).
 */
export async function userExists(userId: string): Promise<boolean> {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result.length > 0;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const [user] = await db
    .select(userSelection)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function getOrCreateLocalAgentAuthUser(): Promise<UserRecord> {
  const existingUser = await getUserById(LOCAL_AGENT_AUTH_USER_ID);
  if (existingUser) {
    return existingUser;
  }

  const now = new Date();
  const [createdUser] = await db
    .insert(users)
    .values({
      id: LOCAL_AGENT_AUTH_USER_ID,
      provider: "vercel",
      externalId: LOCAL_AGENT_AUTH_EXTERNAL_ID,
      accessToken: "",
      refreshToken: null,
      scope: null,
      username: LOCAL_AGENT_AUTH_USER_ID,
      email: "agent@example.com",
      name: "Open Harness Agent",
      avatarUrl: null,
      tokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    })
    .onConflictDoNothing({ target: users.id })
    .returning(userSelection);

  if (createdUser) {
    return createdUser;
  }

  const conflictedUser = await getUserById(LOCAL_AGENT_AUTH_USER_ID);
  if (conflictedUser) {
    return conflictedUser;
  }

  throw new Error("Failed to provision local agent auth user");
}

export async function upsertUser(userData: {
  provider: "github" | "vercel";
  externalId: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  username: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  tokenExpiresAt?: Date;
}): Promise<string> {
  const {
    provider,
    externalId,
    accessToken,
    refreshToken,
    scope,
    tokenExpiresAt,
  } = userData;

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.externalId, externalId)))
    .limit(1);

  if (existingUser.length > 0 && existingUser[0]) {
    await db
      .update(users)
      .set({
        accessToken,
        refreshToken,
        scope,
        tokenExpiresAt,
        username: userData.username,
        email: userData.email,
        name: userData.name,
        avatarUrl: userData.avatarUrl,
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, existingUser[0].id));
    return existingUser[0].id;
  }

  const userId = nanoid();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    ...userData,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
  return userId;
}
