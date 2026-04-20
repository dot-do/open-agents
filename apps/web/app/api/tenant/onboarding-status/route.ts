import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  githubInstallations,
  memberships,
  sessions,
  tenantStripeCustomers,
} from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";

/**
 * GET /api/tenant/onboarding-status
 *
 * Returns completion status for each onboarding step. Tenant-scoped via
 * `requireTenantCtx`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const [ghResult, memberResult, planResult, sessionResult] = await Promise.all(
    [
      db
        .select({ value: count() })
        .from(githubInstallations)
        .where(eq(githubInstallations.tenantId, ctx.tenantId)),
      db
        .select({ value: count() })
        .from(memberships)
        .where(eq(memberships.tenantId, ctx.tenantId)),
      db
        .select({ plan: tenantStripeCustomers.plan })
        .from(tenantStripeCustomers)
        .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
        .limit(1),
      db
        .select({ value: count() })
        .from(sessions)
        .where(eq(sessions.tenantId, ctx.tenantId)),
    ],
  );

  const ghCount = ghResult[0]?.value ?? 0;
  const memberCount = memberResult[0]?.value ?? 0;
  const plan = planResult[0]?.plan ?? "free";
  const sessionCount = sessionResult[0]?.value ?? 0;

  const steps = {
    github: ghCount > 0,
    team: memberCount > 1,
    plan: plan !== "free",
    session: sessionCount > 0,
  };

  const complete = steps.github && steps.team && steps.plan && steps.session;

  return NextResponse.json({ complete, steps });
}
