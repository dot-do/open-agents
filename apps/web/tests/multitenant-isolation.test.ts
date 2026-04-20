import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

/**
 * E2E smoke test verifying multitenant data isolation (bd open-agents-pf6).
 *
 * Exercises two independent layers:
 *   1. App-level `scopedQuery` (apps/web/lib/db/tenant-guard.ts): auto-injects
 *      `eq(tenantId, ctx.tenantId)` into select/update/delete.
 *   2. Postgres RLS (0034_tenant_rls.sql): a transaction that primes
 *      `app.tenant_id` via `setTenantContext(tx, id)` can only see that
 *      tenant's rows, even via raw SQL.
 *
 * Self-skips when POSTGRES_URL is unset so it won't break environments
 * without a test database. To run locally:
 *   POSTGRES_URL=postgres://... bun run test:isolated
 * (the schema must already be migrated — run `bun run --cwd apps/web db:migrate:apply`).
 */

const SKIP = !process.env.POSTGRES_URL;

if (SKIP) {
  // biome-ignore lint/suspicious/noConsole: intentional user-facing skip notice
  console.log(
    "[multitenant-isolation.test] skipped: set POSTGRES_URL to enable",
  );
}

// Guard every import behind the skip so a missing POSTGRES_URL doesn't blow up
// on module load (the db client Proxy throws lazily, but schema import chain
// pulls in server-only modules we'd rather not load at all).
const describeMaybe = SKIP ? describe.skip : describe;

describeMaybe("multitenant data isolation (e2e)", () => {
  // Lazy — populated in beforeAll.
  // biome-ignore lint/suspicious/noExplicitAny: dynamic imports bind late
  let mod: any;
  // biome-ignore lint/suspicious/noExplicitAny: ditto
  let db: any;

  const suffix = Math.random().toString(36).slice(2, 10);
  const tenantA = { id: `ten-a-${suffix}`, slug: `ta-${suffix}`, name: "A" };
  const tenantB = { id: `ten-b-${suffix}`, slug: `tb-${suffix}`, name: "B" };
  const userA = { id: `usr-a-${suffix}`, externalId: `ext-a-${suffix}` };
  const userB = { id: `usr-b-${suffix}`, externalId: `ext-b-${suffix}` };
  const sessionA = { id: `ses-a-${suffix}` };
  const sessionB = { id: `ses-b-${suffix}` };
  const chatA = { id: `cht-a-${suffix}` };
  const chatB = { id: `cht-b-${suffix}` };
  const apiKeyA = { id: `key-a-${suffix}` };
  const apiKeyB = { id: `key-b-${suffix}` };
  const ghA = { id: `gh-a-${suffix}`, installationId: 9000001 };
  const ghB = { id: `gh-b-${suffix}`, installationId: 9000002 };
  const auditA = { id: `aud-a-${suffix}` };
  const auditB = { id: `aud-b-${suffix}` };

  // Wave 6 test data ids
  const workflowRunA = { id: `wfr-a-${suffix}` };
  const workflowRunB = { id: `wfr-b-${suffix}` };
  const usageA = { id: `usg-a-${suffix}` };
  const usageB = { id: `usg-b-${suffix}` };
  const webhookA = { id: `whk-a-${suffix}` };
  const webhookB = { id: `whk-b-${suffix}` };
  const inviteA = { id: `inv-a-${suffix}` };
  const inviteB = { id: `inv-b-${suffix}` };
  const alertA = { id: `alt-a-${suffix}` };
  const alertB = { id: `alt-b-${suffix}` };
  const tokenA = { id: `tok-a-${suffix}` };
  const tokenB = { id: `tok-b-${suffix}` };
  const msgA = { id: `msg-a-${suffix}` };
  const msgB = { id: `msg-b-${suffix}` };
  const prefA = { id: `prf-a-${suffix}` };
  const prefB = { id: `prf-b-${suffix}` };

  beforeAll(async () => {
    mod = {
      schema: await import("@/lib/db/schema"),
      client: await import("@/lib/db/client"),
      guard: await import("@/lib/db/tenant-guard"),
      rls: await import("@/lib/db/rls"),
    };
    db = mod.client.db;
    const s = mod.schema;

    await db.insert(s.tenants).values([tenantA, tenantB]);
    await db.insert(s.users).values([
      {
        id: userA.id,
        provider: "github",
        externalId: userA.externalId,
        accessToken: "x",
        username: `ua-${suffix}`,
      },
      {
        id: userB.id,
        provider: "github",
        externalId: userB.externalId,
        accessToken: "x",
        username: `ub-${suffix}`,
      },
    ]);
    await db.insert(s.memberships).values([
      { tenantId: tenantA.id, userId: userA.id, role: "owner" },
      { tenantId: tenantB.id, userId: userB.id, role: "owner" },
    ]);
    await db.insert(s.sessions).values([
      {
        id: sessionA.id,
        userId: userA.id,
        tenantId: tenantA.id,
        title: "A-session",
      },
      {
        id: sessionB.id,
        userId: userB.id,
        tenantId: tenantB.id,
        title: "B-session",
      },
    ]);
    await db.insert(s.chats).values([
      {
        id: chatA.id,
        sessionId: sessionA.id,
        tenantId: tenantA.id,
        title: "A-chat",
      },
      {
        id: chatB.id,
        sessionId: sessionB.id,
        tenantId: tenantB.id,
        title: "B-chat",
      },
    ]);
    await db.insert(s.tenantApiKeys).values([
      {
        id: apiKeyA.id,
        tenantId: tenantA.id,
        provider: "anthropic",
        encryptedKey: "cipher-A",
        keyHint: "AAAA",
        createdByUserId: userA.id,
      },
      {
        id: apiKeyB.id,
        tenantId: tenantB.id,
        provider: "anthropic",
        encryptedKey: "cipher-B",
        keyHint: "BBBB",
        createdByUserId: userB.id,
      },
    ]);
    await db.insert(s.githubInstallations).values([
      {
        id: ghA.id,
        userId: userA.id,
        tenantId: tenantA.id,
        installationId: ghA.installationId,
        accountLogin: `la-${suffix}`,
        accountType: "User",
        repositorySelection: "all",
      },
      {
        id: ghB.id,
        userId: userB.id,
        tenantId: tenantB.id,
        installationId: ghB.installationId,
        accountLogin: `lb-${suffix}`,
        accountType: "User",
        repositorySelection: "all",
      },
    ]);
    await db.insert(s.auditEvents).values([
      {
        id: auditA.id,
        tenantId: tenantA.id,
        actorUserId: userA.id,
        action: "test.create",
      },
      {
        id: auditB.id,
        tenantId: tenantB.id,
        actorUserId: userB.id,
        action: "test.create",
      },
    ]);

    // Chat messages
    await db.insert(s.chatMessages).values([
      {
        id: msgA.id,
        chatId: chatA.id,
        tenantId: tenantA.id,
        role: "user",
        parts: JSON.stringify([{ type: "text", text: "hello from A" }]),
      },
      {
        id: msgB.id,
        chatId: chatB.id,
        tenantId: tenantB.id,
        role: "user",
        parts: JSON.stringify([{ type: "text", text: "hello from B" }]),
      },
    ]);

    // Workflow runs
    const now = new Date();
    await db.insert(s.workflowRuns).values([
      {
        id: workflowRunA.id,
        chatId: chatA.id,
        sessionId: sessionA.id,
        userId: userA.id,
        tenantId: tenantA.id,
        status: "completed",
        startedAt: now,
        finishedAt: now,
        totalDurationMs: 100,
      },
      {
        id: workflowRunB.id,
        chatId: chatB.id,
        sessionId: sessionB.id,
        userId: userB.id,
        tenantId: tenantB.id,
        status: "completed",
        startedAt: now,
        finishedAt: now,
        totalDurationMs: 200,
      },
    ]);

    // Usage events
    await db.insert(s.usageEvents).values([
      {
        id: usageA.id,
        userId: userA.id,
        tenantId: tenantA.id,
        provider: "anthropic",
        modelId: "claude-3",
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        id: usageB.id,
        userId: userB.id,
        tenantId: tenantB.id,
        provider: "anthropic",
        modelId: "claude-3",
        inputTokens: 200,
        outputTokens: 75,
      },
    ]);

    // Webhooks
    await db.insert(s.tenantWebhooks).values([
      {
        id: webhookA.id,
        tenantId: tenantA.id,
        url: "https://a.example.com/hook",
        secret: "secret-a",
        events: ["session.completed"],
      },
      {
        id: webhookB.id,
        tenantId: tenantB.id,
        url: "https://b.example.com/hook",
        secret: "secret-b",
        events: ["session.completed"],
      },
    ]);

    // Invites
    const future = new Date(Date.now() + 86400000);
    await db.insert(s.tenantInvites).values([
      {
        id: inviteA.id,
        tenantId: tenantA.id,
        email: "invite-a@example.com",
        role: "member",
        token: `tok-inv-a-${suffix}`,
        invitedByUserId: userA.id,
        expiresAt: future,
      },
      {
        id: inviteB.id,
        tenantId: tenantB.id,
        email: "invite-b@example.com",
        role: "member",
        token: `tok-inv-b-${suffix}`,
        invitedByUserId: userB.id,
        expiresAt: future,
      },
    ]);

    // Quota alerts
    await db.insert(s.tenantQuotaAlerts).values([
      {
        id: alertA.id,
        tenantId: tenantA.id,
        kind: "daily_cost",
        threshold: 80,
        periodKey: "2026-04-15",
      },
      {
        id: alertB.id,
        tenantId: tenantB.id,
        kind: "daily_cost",
        threshold: 80,
        periodKey: "2026-04-15",
      },
    ]);

    // API tokens (PAT)
    await db.insert(s.tenantApiTokens).values([
      {
        id: tokenA.id,
        tenantId: tenantA.id,
        name: "token-A",
        tokenHash: `hash-a-${suffix}`,
        tokenHint: "aaaa",
        scope: "read",
        createdByUserId: userA.id,
      },
      {
        id: tokenB.id,
        tenantId: tenantB.id,
        name: "token-B",
        tokenHash: `hash-b-${suffix}`,
        tokenHint: "bbbb",
        scope: "read",
        createdByUserId: userB.id,
      },
    ]);

    // Vercel project links
    await db.insert(s.vercelProjectLinks).values([
      {
        userId: userA.id,
        tenantId: tenantA.id,
        repoOwner: "owner-a",
        repoName: `repo-a-${suffix}`,
        projectId: `proj-a-${suffix}`,
        projectName: "proj-a",
      },
      {
        userId: userB.id,
        tenantId: tenantB.id,
        repoOwner: "owner-b",
        repoName: `repo-b-${suffix}`,
        projectId: `proj-b-${suffix}`,
        projectName: "proj-b",
      },
    ]);

    // User preferences (user-scoped but has tenantId column)
    await db.insert(s.userPreferences).values([
      {
        id: prefA.id,
        userId: userA.id,
        tenantId: tenantA.id,
      },
      {
        id: prefB.id,
        userId: userB.id,
        tenantId: tenantB.id,
      },
    ]);
  });

  afterAll(async () => {
    if (!mod) return;
    const s = mod.schema;
    // Delete in FK-safe order (children first).
    await db.delete(s.userPreferences).where(
      sql`${s.userPreferences.id} in (${prefA.id}, ${prefB.id})`,
    );
    await db.delete(s.vercelProjectLinks).where(
      sql`${s.vercelProjectLinks.tenantId} in (${tenantA.id}, ${tenantB.id})`,
    );
    await db.delete(s.tenantApiTokens).where(
      sql`${s.tenantApiTokens.id} in (${tokenA.id}, ${tokenB.id})`,
    );
    await db.delete(s.tenantQuotaAlerts).where(
      sql`${s.tenantQuotaAlerts.id} in (${alertA.id}, ${alertB.id})`,
    );
    await db.delete(s.tenantInvites).where(
      sql`${s.tenantInvites.id} in (${inviteA.id}, ${inviteB.id})`,
    );
    await db.delete(s.tenantWebhooks).where(
      sql`${s.tenantWebhooks.id} in (${webhookA.id}, ${webhookB.id})`,
    );
    await db.delete(s.usageEvents).where(
      sql`${s.usageEvents.id} in (${usageA.id}, ${usageB.id})`,
    );
    await db.delete(s.workflowRuns).where(
      sql`${s.workflowRuns.id} in (${workflowRunA.id}, ${workflowRunB.id})`,
    );
    await db.delete(s.chatMessages).where(
      sql`${s.chatMessages.id} in (${msgA.id}, ${msgB.id})`,
    );
    await db.delete(s.auditEvents).where(
      sql`${s.auditEvents.tenantId} in (${tenantA.id}, ${tenantB.id})`,
    );
    await db.delete(s.tenantApiKeys).where(
      sql`${s.tenantApiKeys.tenantId} in (${tenantA.id}, ${tenantB.id})`,
    );
    await db.delete(s.githubInstallations).where(
      sql`${s.githubInstallations.id} in (${ghA.id}, ${ghB.id})`,
    );
    await db
      .delete(s.chats)
      .where(sql`${s.chats.id} in (${chatA.id}, ${chatB.id})`);
    await db
      .delete(s.sessions)
      .where(sql`${s.sessions.id} in (${sessionA.id}, ${sessionB.id})`);
    await db
      .delete(s.memberships)
      .where(sql`${s.memberships.userId} in (${userA.id}, ${userB.id})`);
    await db
      .delete(s.users)
      .where(sql`${s.users.id} in (${userA.id}, ${userB.id})`);
    await db
      .delete(s.tenants)
      .where(sql`${s.tenants.id} in (${tenantA.id}, ${tenantB.id})`);
  });

  // -----------------------------------------------------------------------
  // Original scopedQuery + RLS tests
  // -----------------------------------------------------------------------

  describe("scopedQuery basics", () => {
    test("A sees only A's rows across all tenant-scoped tables", async () => {
      const s = mod.schema;
      const ctxA = { tenantId: tenantA.id };
      const scoped = mod.guard.scopedQuery(ctxA);

      const tables = [
        s.sessions,
        s.chats,
        s.tenantApiKeys,
        s.githubInstallations,
        s.auditEvents,
      ];
      for (const t of tables) {
        const rows = (await scoped.selectFrom(t)) as unknown as Array<{
          tenantId: string | null;
        }>;
        expect(rows.length).toBeGreaterThanOrEqual(1);
        for (const r of rows) {
          expect(r.tenantId).toBe(tenantA.id);
        }
      }
    });

    test("B sees only B's rows", async () => {
      const s = mod.schema;
      const ctxB = { tenantId: tenantB.id };
      const scoped = mod.guard.scopedQuery(ctxB);
      const tables = [
        s.sessions,
        s.chats,
        s.tenantApiKeys,
        s.githubInstallations,
        s.auditEvents,
      ];
      for (const t of tables) {
        const rows = (await scoped.selectFrom(t)) as unknown as Array<{
          tenantId: string | null;
        }>;
        for (const r of rows) {
          expect(r.tenantId).toBe(tenantB.id);
        }
      }
    });

    test("scopedQuery update: A cannot update B's session", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const result = (await scopedA.updateSet(
        s.sessions,
        eq(s.sessions.id, sessionB.id),
        { title: "pwned-by-A" },
      )) as unknown as { count?: number };
      expect(result.count ?? 0).toBe(0);

      const rows = await db
        .select({ title: s.sessions.title })
        .from(s.sessions)
        .where(eq(s.sessions.id, sessionB.id));
      expect(rows[0]?.title).toBe("B-session");
    });

    test("scopedQuery delete: A cannot delete B's chat", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const result = (await scopedA.deleteFrom(
        s.chats,
        eq(s.chats.id, chatB.id),
      )) as unknown as { count?: number };
      expect(result.count ?? 0).toBe(0);

      const rows = await db
        .select({ id: s.chats.id })
        .from(s.chats)
        .where(eq(s.chats.id, chatB.id));
      expect(rows.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // RLS
  // -----------------------------------------------------------------------

  describe("RLS transaction isolation", () => {
    test("transaction primed with tenant A sees only A's sessions", async () => {
      const s = mod.schema;
      await db.transaction(async (tx: unknown) => {
        await mod.rls.setTenantContext(
          tx as { execute: (q: unknown) => Promise<unknown> },
          tenantA.id,
        );
        // biome-ignore lint/suspicious/noExplicitAny: tx type
        const rows = (await (tx as any)
          .select()
          .from(s.sessions)) as Array<{ tenantId: string | null }>;
        expect(rows.length).toBeGreaterThanOrEqual(1);
        for (const r of rows) {
          expect(r.tenantId).toBe(tenantA.id);
        }
        // biome-ignore lint/suspicious/noExplicitAny: tx type
        const byId = await (tx as any)
          .select()
          .from(s.sessions)
          .where(eq(s.sessions.id, sessionB.id));
        expect(byId.length).toBe(0);
      });
    });

    test("transaction primed with tenant B sees only B's sessions", async () => {
      const s = mod.schema;
      await db.transaction(async (tx: unknown) => {
        await mod.rls.setTenantContext(
          tx as { execute: (q: unknown) => Promise<unknown> },
          tenantB.id,
        );
        // biome-ignore lint/suspicious/noExplicitAny: tx type
        const rows = (await (tx as any)
          .select()
          .from(s.sessions)) as Array<{ tenantId: string | null }>;
        expect(rows.length).toBeGreaterThanOrEqual(1);
        for (const r of rows) {
          expect(r.tenantId).toBe(tenantB.id);
        }
      });
    });

    test("unprimed transaction: scopedQuery still enforces isolation", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.sessions,
        and(eq(s.sessions.id, sessionB.id)),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Chat mutations
  // -----------------------------------------------------------------------

  describe("chat mutations", () => {
    test("updateChat: A cannot update B's chat title", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const result = (await scopedA.updateSet(
        s.chats,
        eq(s.chats.id, chatB.id),
        { title: "pwned" },
      )) as unknown as { count?: number };
      expect(result.count ?? 0).toBe(0);

      const rows = await db
        .select({ title: s.chats.title })
        .from(s.chats)
        .where(eq(s.chats.id, chatB.id));
      expect(rows[0]?.title).toBe("B-chat");
    });

    test("touchChat: A cannot update B's chat updatedAt", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const result = (await scopedA.updateSet(
        s.chats,
        eq(s.chats.id, chatB.id),
        { updatedAt: new Date() },
      )) as unknown as { count?: number };
      expect(result.count ?? 0).toBe(0);
    });

    test("deleteChat: A cannot delete B's chat", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const result = (await scopedA.deleteFrom(
        s.chats,
        eq(s.chats.id, chatB.id),
      )) as unknown as { count?: number };
      expect(result.count ?? 0).toBe(0);

      const rows = await db
        .select({ id: s.chats.id })
        .from(s.chats)
        .where(eq(s.chats.id, chatB.id));
      expect(rows.length).toBe(1);
    });

    test("getChatMessages: A cannot see B's chat messages", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.chatMessages,
        eq(s.chatMessages.chatId, chatB.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Workflow runs
  // -----------------------------------------------------------------------

  describe("workflow runs", () => {
    test("A sees only A's workflow runs", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.workflowRuns,
      )) as unknown as Array<{ tenantId: string | null; id: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's workflow runs", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.workflowRuns,
        eq(s.workflowRuns.id, workflowRunA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Usage events
  // -----------------------------------------------------------------------

  describe("usage events", () => {
    test("A sees only A's usage events", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.usageEvents,
      )) as unknown as Array<{ tenantId: string | null }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's usage events", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.usageEvents,
        eq(s.usageEvents.id, usageA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Tenant API keys
  // -----------------------------------------------------------------------

  describe("tenant API keys", () => {
    test("A sees only A's API keys", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.tenantApiKeys,
      )) as unknown as Array<{ tenantId: string; id: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's API keys", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.tenantApiKeys,
        eq(s.tenantApiKeys.id, apiKeyA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Webhooks
  // -----------------------------------------------------------------------

  describe("webhooks", () => {
    test("A sees only A's webhooks", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.tenantWebhooks,
      )) as unknown as Array<{ tenantId: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's webhooks", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.tenantWebhooks,
        eq(s.tenantWebhooks.id, webhookA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Invites
  // -----------------------------------------------------------------------

  describe("invites", () => {
    test("A sees only A's invites", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.tenantInvites,
      )) as unknown as Array<{ tenantId: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's invites", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.tenantInvites,
        eq(s.tenantInvites.id, inviteA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Quota alerts
  // -----------------------------------------------------------------------

  describe("quota alerts", () => {
    test("A sees only A's quota alerts", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.tenantQuotaAlerts,
      )) as unknown as Array<{ tenantId: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's quota alerts", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.tenantQuotaAlerts,
        eq(s.tenantQuotaAlerts.id, alertA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // API tokens (PAT)
  // -----------------------------------------------------------------------

  describe("API tokens (PAT)", () => {
    test("A sees only A's tokens", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.tenantApiTokens,
      )) as unknown as Array<{ tenantId: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's tokens", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.tenantApiTokens,
        eq(s.tenantApiTokens.id, tokenA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Vercel project links
  // -----------------------------------------------------------------------

  describe("vercel project links", () => {
    test("A sees only A's project links", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.vercelProjectLinks,
      )) as unknown as Array<{ tenantId: string | null }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's project links", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.vercelProjectLinks,
        eq(s.vercelProjectLinks.userId, userA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // User preferences (user-scoped + tenantId column)
  // -----------------------------------------------------------------------

  describe("user preferences", () => {
    test("has tenantId column and scopedQuery isolates by tenant", async () => {
      const s = mod.schema;
      const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
      const rows = (await scopedA.selectFrom(
        s.userPreferences,
      )) as unknown as Array<{ tenantId: string | null; userId: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.tenantId).toBe(tenantA.id);
      }
    });

    test("B cannot see A's preferences via scopedQuery", async () => {
      const s = mod.schema;
      const scopedB = mod.guard.scopedQuery({ tenantId: tenantB.id });
      const rows = (await scopedB.selectFrom(
        s.userPreferences,
        eq(s.userPreferences.id, prefA.id),
      )) as unknown as unknown[];
      expect(rows.length).toBe(0);
    });

    test("userPreferences table has tenantId (user+tenant scoped, not user-only)", async () => {
      // Verify the schema includes tenantId — documenting that preferences
      // are tenant-scoped (a user can have different prefs per org).
      const s = mod.schema;
      expect(s.userPreferences.tenantId).toBeDefined();
    });
  });
});
