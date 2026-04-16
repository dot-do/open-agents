#!/usr/bin/env bun
/**
 * Admin CLI for tenant sandbox ops.
 *
 * Usage:
 *   bun run admin:sandboxes list  --tenant=<id>
 *   bun run admin:sandboxes kill  --tenant=<id>
 *   bun run admin:sandboxes stats --tenant=<id>
 *
 * Requires DATABASE_URL to be set in the calling environment.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../apps/web/lib/db/client";
import { sessions } from "../apps/web/lib/db/schema";
import {
  getCurrentDayCostCents,
  getCurrentMonthMinutes,
  getTenantQuotas,
  killTenantSandboxes,
} from "../apps/web/lib/quotas";

const ACTIVE = ["provisioning", "active", "restoring"] as const;

function parseArgs(argv: string[]): { cmd: string; tenant: string | null } {
  const [cmd, ...rest] = argv;
  let tenant: string | null = null;
  for (const arg of rest) {
    if (arg.startsWith("--tenant=")) tenant = arg.slice("--tenant=".length);
  }
  return { cmd: cmd ?? "", tenant };
}

async function list(tenantId: string): Promise<void> {
  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      lifecycleState: sessions.lifecycleState,
      sandboxExpiresAt: sessions.sandboxExpiresAt,
      lastActivityAt: sessions.lastActivityAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        inArray(sessions.lifecycleState, [...ACTIVE]),
      ),
    );
  console.log(
    JSON.stringify({ tenantId, count: rows.length, sandboxes: rows }, null, 2),
  );
}

async function kill(tenantId: string): Promise<void> {
  const results = await killTenantSandboxes(tenantId, "admin_cli");
  console.log(JSON.stringify({ tenantId, results }, null, 2));
}

async function stats(tenantId: string): Promise<void> {
  const [quotas, minutes, cents, rows] = await Promise.all([
    getTenantQuotas(tenantId),
    getCurrentMonthMinutes(tenantId),
    getCurrentDayCostCents(tenantId),
    db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          inArray(sessions.lifecycleState, [...ACTIVE]),
        ),
      ),
  ]);
  console.log(
    JSON.stringify(
      {
        tenantId,
        quotas,
        usage: {
          activeSandboxes: rows.length,
          monthSandboxMinutes: minutes,
          dayCostCents: cents,
        },
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { cmd, tenant } = parseArgs(process.argv.slice(2));
  if (!tenant) {
    console.error("Missing --tenant=<id>");
    process.exit(2);
  }
  switch (cmd) {
    case "list":
      await list(tenant);
      break;
    case "kill":
      await kill(tenant);
      break;
    case "stats":
      await stats(tenant);
      break;
    default:
      console.error(
        `Unknown command '${cmd}'. Expected: list | kill | stats`,
      );
      process.exit(2);
  }
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
