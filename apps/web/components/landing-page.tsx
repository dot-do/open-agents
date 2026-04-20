"use client";

import {
  Clock,
  Container,
  Key,
  Users,
  Check,
  X,
  ArrowRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * Pricing data — mirrors PLAN_MATRIX from lib/billing.ts (which is
 * server-only). We keep display-level fields here to avoid importing a
 * server-only module into a client component.
 * -------------------------------------------------------------------------*/

type PlanDisplay = {
  name: string;
  description: string;
  concurrentSandboxes: string;
  byoKeys: boolean;
  sso: boolean;
  models: string;
  cta: string;
  highlight?: boolean;
};

const PLANS: PlanDisplay[] = [
  {
    name: "Free",
    description: "For individuals getting started",
    concurrentSandboxes: "1",
    byoKeys: false,
    sso: false,
    models: "Basic",
    cta: "Start free",
  },
  {
    name: "Pro",
    description: "For power users shipping daily",
    concurrentSandboxes: "3",
    byoKeys: true,
    sso: false,
    models: "Standard",
    cta: "Upgrade",
    highlight: true,
  },
  {
    name: "Team",
    description: "For teams building together",
    concurrentSandboxes: "10",
    byoKeys: true,
    sso: false,
    models: "All",
    cta: "Upgrade",
  },
  {
    name: "Enterprise",
    description: "Custom limits, SSO, and support",
    concurrentSandboxes: "Custom",
    byoKeys: true,
    sso: true,
    models: "All",
    cta: "Contact us",
  },
];

/* ---------------------------------------------------------------------------
 * Feature cards
 * -------------------------------------------------------------------------*/

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-(--l-border) bg-(--l-bg) p-6 transition-colors hover:border-(--l-fg-5)">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-(--l-fg-6) text-(--l-fg)">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-(--l-fg)">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-(--l-fg-2)">
        {description}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Pricing card
 * -------------------------------------------------------------------------*/

function PricingRow({
  label,
  value,
}: {
  label: string;
  value: string | boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-(--l-fg-2)">{label}</span>
      {typeof value === "boolean" ? (
        value ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <X className="h-4 w-4 text-(--l-fg-4)" />
        )
      ) : (
        <span className="font-medium text-(--l-fg)">{value}</span>
      )}
    </div>
  );
}

function PricingCard({ plan }: { plan: PlanDisplay }) {
  const isEnterprise = plan.name === "Enterprise";

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-6",
        plan.highlight
          ? "border-(--l-fg-3) ring-1 ring-(--l-fg-3)"
          : "border-(--l-border)",
      )}
    >
      {plan.highlight && (
        <span className="mb-3 w-fit rounded-full bg-(--l-fg) px-3 py-0.5 text-xs font-medium text-(--l-bg)">
          Popular
        </span>
      )}
      <h3 className="text-xl font-semibold text-(--l-fg)">{plan.name}</h3>
      <p className="mt-1 text-sm text-(--l-fg-2)">{plan.description}</p>

      <div className="mt-6 space-y-0 divide-y divide-(--l-border)">
        <PricingRow
          label="Concurrent sandboxes"
          value={plan.concurrentSandboxes}
        />
        <PricingRow label="BYO API keys" value={plan.byoKeys} />
        <PricingRow label="SSO" value={plan.sso} />
        <PricingRow label="Models" value={plan.models} />
      </div>

      <div className="mt-auto pt-6">
        {isEnterprise ? (
          <a
            href="mailto:support@openagents.com"
            className="flex h-10 w-full items-center justify-center rounded-md border border-(--l-border) text-sm font-medium text-(--l-fg) transition-colors hover:bg-(--l-fg-6)"
          >
            {plan.cta}
          </a>
        ) : (
          <SignInButton
            className="w-full"
            variant={plan.highlight ? "default" : "outline"}
          >
            {plan.cta}
          </SignInButton>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Main landing page
 * -------------------------------------------------------------------------*/

export function LandingPage() {
  return (
    <div className="landing relative isolate min-h-screen bg-(--l-bg) text-(--l-fg) selection:bg-(--l-fg)/20">
      {/* Side borders (matches existing landing aesthetic) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden md:block">
        <div className="mx-auto h-full max-w-[1320px] border-x border-x-(--l-border)" />
      </div>

      <div className="relative z-10">
        {/* ---- Nav ---- */}
        <nav className="flex h-16 items-center justify-between px-6">
          <span className="text-lg font-semibold text-(--l-fg)">
            Open Agents
          </span>
          <SignInButton size="sm" />
        </nav>

        {/* ---- Hero ---- */}
        <section className="px-6 pb-24 pt-20 md:pt-32">
          <div className="mx-auto max-w-[1320px]">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tighter sm:text-5xl md:text-7xl">
                Ship faster with autonomous coding agents
              </h1>
              <p className="mt-5 max-w-xl text-balance text-base leading-relaxed text-(--l-fg-2) sm:mt-6 sm:text-xl">
                Spawn infinite cloud agents that clone your repo, write code on
                an isolated branch, and open a pull request — all while you
                focus on what matters.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <SignInButton size="lg">
                  Get started
                  <ArrowRight className="ml-1 h-4 w-4" />
                </SignInButton>
                <a
                  href="#pricing"
                  className="inline-flex h-10 items-center rounded-md border border-(--l-border) px-6 text-sm font-medium text-(--l-fg) transition-colors hover:bg-(--l-fg-6)"
                >
                  View pricing
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Features ---- */}
        <section className="border-t border-(--l-border) px-6 py-20 md:py-28">
          <div className="mx-auto max-w-[1320px]">
            <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything you need to ship with agents
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-(--l-fg-2) sm:text-base">
              Cloud-native infrastructure purpose-built for autonomous coding
              workflows.
            </p>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard
                icon={<Clock className="h-5 w-5" />}
                title="Infinite runtime"
                description="Agents run until the job is done, not limited by your laptop being open or your terminal staying alive."
              />
              <FeatureCard
                icon={<Container className="h-5 w-5" />}
                title="Isolated sandboxes"
                description="Each agent gets its own VM with a dedicated git branch. No local state, no conflicts, fully reproducible."
              />
              <FeatureCard
                icon={<Users className="h-5 w-5" />}
                title="Team workspaces"
                description="Collaborate with tenant-scoped agents, role-based access control, and full audit logs."
              />
              <FeatureCard
                icon={<Key className="h-5 w-5" />}
                title="BYO keys"
                description="Bring your own model API keys for any provider. Use the models you trust at the rates you negotiate."
              />
            </div>
          </div>
        </section>

        {/* ---- Pricing ---- */}
        <section
          id="pricing"
          className="scroll-mt-16 border-t border-(--l-border) px-6 py-20 md:py-28"
        >
          <div className="mx-auto max-w-[1320px]">
            <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              Simple, transparent pricing
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-(--l-fg-2) sm:text-base">
              Start free and scale as your team grows.
            </p>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((plan) => (
                <PricingCard key={plan.name} plan={plan} />
              ))}
            </div>
          </div>
        </section>

        {/* ---- Footer ---- */}
        <footer className="border-t border-(--l-border) px-6 py-10">
          <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-3 text-center text-sm text-(--l-fg-3)">
            <a
              href="https://github.com/dot-do/open-agents"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-(--l-fg-2)"
            >
              Powered by Open Agents
            </a>
            <span>MIT License</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
