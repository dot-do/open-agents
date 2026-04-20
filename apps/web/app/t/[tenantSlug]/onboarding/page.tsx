import { and, count, eq, gt } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { db } from "@/lib/db/client";
import {
  githubInstallations,
  memberships,
  sessions,
  tenantStripeCustomers,
} from "@/lib/db/schema";
import { lookupTenantBySlug } from "@/lib/db/tenants";

export const dynamic = "force-dynamic";

/**
 * Onboarding page for a newly created tenant. Only renders if the tenant was
 * created within the last 7 days AND has no sessions AND no GitHub
 * installations. Otherwise redirects to the tenant home.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await lookupTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const isRecent = tenant.createdAt > sevenDaysAgo;

  // Always allow visiting onboarding for recent tenants; check completion
  // status to pre-fill steps.
  const [ghResult, memberResult, planResult, sessionResult] = await Promise.all(
    [
      db
        .select({ value: count() })
        .from(githubInstallations)
        .where(eq(githubInstallations.tenantId, tenant.id)),
      db
        .select({ value: count() })
        .from(memberships)
        .where(eq(memberships.tenantId, tenant.id)),
      db
        .select({ plan: tenantStripeCustomers.plan })
        .from(tenantStripeCustomers)
        .where(eq(tenantStripeCustomers.tenantId, tenant.id))
        .limit(1),
      db
        .select({ value: count() })
        .from(sessions)
        .where(eq(sessions.tenantId, tenant.id)),
    ],
  );

  const ghCount = ghResult[0]?.value ?? 0;
  const memberCount = memberResult[0]?.value ?? 0;
  const plan = planResult[0]?.plan ?? "free";
  const sessionCount = sessionResult[0]?.value ?? 0;

  const allDone = ghCount > 0 && memberCount > 1 && plan !== "free" && sessionCount > 0;

  // If not recent and everything is done, skip onboarding entirely.
  if (!isRecent && allDone) {
    redirect(`/t/${tenantSlug}`);
  }

  const completedSteps = {
    github: ghCount > 0,
    team: memberCount > 1,
    plan: plan !== "free",
    session: sessionCount > 0,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 px-6 py-4">
        <h1 className="text-center text-sm font-medium text-muted-foreground">
          Set up your workspace
        </h1>
      </div>
      <OnboardingWizard tenantSlug={tenantSlug} completedSteps={completedSteps} />
    </div>
  );
}
