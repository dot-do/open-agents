/**
 * Dev seed script — creates sample users, tenants, memberships, sessions,
 * chats, and quota rows. Idempotent: uses INSERT ... ON CONFLICT DO NOTHING
 * so running twice is a no-op.
 *
 * Usage: bun run seed  (requires POSTGRES_URL env var)
 */

import { db } from "../apps/web/lib/db/client";
import {
  users,
  tenants,
  memberships,
  sessions,
  chats,
  chatMessages,
  tenantQuotas,
} from "../apps/web/lib/db/schema";

async function seed() {
  console.log("Seeding database...");

  // --- Users ---
  await db
    .insert(users)
    .values([
      {
        id: "seed_alice",
        provider: "github",
        externalId: "seed-ext-alice",
        accessToken: "seed-token-alice",
        username: "seed-alice",
        email: "alice@example.com",
        name: "Alice Seed",
      },
      {
        id: "seed_bob",
        provider: "github",
        externalId: "seed-ext-bob",
        accessToken: "seed-token-bob",
        username: "seed-bob",
        email: "bob@example.com",
        name: "Bob Seed",
      },
    ])
    .onConflictDoNothing();
  console.log("  users: seed_alice, seed_bob");

  // --- Tenants ---
  await db
    .insert(tenants)
    .values([
      {
        id: "tenant_alice",
        slug: "alices-workspace",
        name: "Alice's Workspace",
      },
      {
        id: "tenant_bob",
        slug: "bobs-workshop",
        name: "Bob's Workshop",
      },
    ])
    .onConflictDoNothing();
  console.log("  tenants: alices-workspace, bobs-workshop");

  // --- Memberships ---
  await db
    .insert(memberships)
    .values([
      { tenantId: "tenant_alice", userId: "seed_alice", role: "owner" },
      { tenantId: "tenant_bob", userId: "seed_alice", role: "member" },
      { tenantId: "tenant_bob", userId: "seed_bob", role: "owner" },
    ])
    .onConflictDoNothing();
  console.log("  memberships: alice=owner(alice-ws)+member(bob-ws), bob=owner(bob-ws)");

  // --- Sessions ---
  await db
    .insert(sessions)
    .values([
      {
        id: "seed_session_alice",
        userId: "seed_alice",
        tenantId: "tenant_alice",
        title: "Alice's Sample Session",
        status: "running",
      },
      {
        id: "seed_session_bob",
        userId: "seed_bob",
        tenantId: "tenant_bob",
        title: "Bob's Sample Session",
        status: "running",
      },
    ])
    .onConflictDoNothing();
  console.log("  sessions: seed_session_alice, seed_session_bob");

  // --- Chats ---
  await db
    .insert(chats)
    .values([
      {
        id: "seed_chat_alice",
        sessionId: "seed_session_alice",
        tenantId: "tenant_alice",
        title: "Welcome Chat",
      },
      {
        id: "seed_chat_bob",
        sessionId: "seed_session_bob",
        tenantId: "tenant_bob",
        title: "Welcome Chat",
      },
    ])
    .onConflictDoNothing();
  console.log("  chats: seed_chat_alice, seed_chat_bob");

  // --- Welcome messages ---
  await db
    .insert(chatMessages)
    .values([
      {
        id: "seed_msg_alice",
        chatId: "seed_chat_alice",
        tenantId: "tenant_alice",
        role: "assistant",
        parts: [{ type: "text", text: "Welcome to Alice's Workspace!" }],
      },
      {
        id: "seed_msg_bob",
        chatId: "seed_chat_bob",
        tenantId: "tenant_bob",
        role: "assistant",
        parts: [{ type: "text", text: "Welcome to Bob's Workshop!" }],
      },
    ])
    .onConflictDoNothing();
  console.log("  messages: welcome messages");

  // --- Tenant quotas (defaults) ---
  await db
    .insert(tenantQuotas)
    .values([
      {
        tenantId: "tenant_alice",
        maxConcurrentSandboxes: 3,
        maxMonthlyMinutes: 600,
        maxDailyCostCents: 500,
        maxSessions: null,
        hardKillEnabled: true,
      },
      {
        tenantId: "tenant_bob",
        maxConcurrentSandboxes: 3,
        maxMonthlyMinutes: 600,
        maxDailyCostCents: 500,
        maxSessions: null,
        hardKillEnabled: true,
      },
    ])
    .onConflictDoNothing();
  console.log("  tenant_quotas: defaults for both tenants");

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
