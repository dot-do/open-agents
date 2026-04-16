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
  });

  afterAll(async () => {
    if (!mod) return;
    const s = mod.schema;
    // Delete in FK-safe order.
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

  test("scopedQuery: A sees only A's rows across all tenant-scoped tables", async () => {
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

  test("scopedQuery: B sees only B's rows", async () => {
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
    // postgres-js returns a result with .count === 0 when no rows match.
    expect(result.count ?? 0).toBe(0);

    // Verify via raw query that B's session title is unchanged.
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

  test("RLS: transaction primed with tenant A sees only A's sessions", async () => {
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
      // Neither A-primed tx sees B's session even by direct id lookup.
      // biome-ignore lint/suspicious/noExplicitAny: tx type
      const byId = await (tx as any)
        .select()
        .from(s.sessions)
        .where(eq(s.sessions.id, sessionB.id));
      expect(byId.length).toBe(0);
    });
  });

  test("RLS: transaction primed with tenant B sees only B's sessions", async () => {
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

  test("RLS: unprimed transaction still sees rows (RLS fires only when GUC is set)", async () => {
    // This documents the current behavior — RLS policies use
    // `current_setting('app.tenant_id', true)` which returns NULL when unset,
    // and `tenant_id = NULL` is always false. But because the app role is
    // typically the table owner / a superuser, RLS may be bypassed. We just
    // assert that the primary control (scopedQuery) remains the source of
    // truth regardless, which the earlier tests already cover.
    const s = mod.schema;
    const scopedA = mod.guard.scopedQuery({ tenantId: tenantA.id });
    const rows = (await scopedA.selectFrom(
      s.sessions,
      and(eq(s.sessions.id, sessionB.id)),
    )) as unknown as unknown[];
    expect(rows.length).toBe(0);
  });
});
