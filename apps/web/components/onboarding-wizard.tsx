"use client";

import {
  ArrowRight,
  Check,
  CreditCard,
  Github,
  Loader2,
  SkipForward,
  Terminal,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STEPS: OnboardingStep[] = [
  {
    id: "github",
    title: "Connect GitHub",
    description:
      "Install the GitHub App to give your workspace access to repositories.",
    icon: <Github className="h-5 w-5" />,
  },
  {
    id: "team",
    title: "Invite your team",
    description: "Add teammates by email so they can collaborate in this workspace.",
    icon: <Users className="h-5 w-5" />,
  },
  {
    id: "plan",
    title: "Choose your plan",
    description: "Pick a plan that fits your team. You can always change later.",
    icon: <CreditCard className="h-5 w-5" />,
  },
  {
    id: "session",
    title: "Start building",
    description: "Create your first session and start working with an AI agent.",
    icon: <Terminal className="h-5 w-5" />,
  },
];

interface OnboardingWizardProps {
  tenantSlug: string;
  completedSteps?: {
    github: boolean;
    team: boolean;
    plan: boolean;
    session: boolean;
  };
}

export function OnboardingWizard({
  tenantSlug,
  completedSteps,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [inviting, setInviting] = useState(false);
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);

  const totalSteps = STEPS.length;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      router.push(`/t/${tenantSlug}`);
    }
  }, [currentStep, totalSteps, router, tenantSlug]);

  const handleConnectGitHub = useCallback(() => {
    const params = new URLSearchParams({
      next: `/t/${tenantSlug}/onboarding?step=1`,
    });
    window.location.href = `/api/github/app/install?${params.toString()}`;
  }, [tenantSlug]);

  const handleInvite = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      const res = await fetch("/api/tenant/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(payload.error ?? "Failed to send invite");
        return;
      }
      setInvitedEmails((prev) => [...prev, email]);
      setInviteEmail("");
      toast.success(`Invite sent to ${email}`);
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteRole]);

  const step = STEPS[currentStep]!;
  const isCompleted = completedSteps?.[step.id as keyof typeof completedSteps];

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {currentStep + 1} of {totalSteps}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step indicator dots */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => {
          const done =
            completedSteps?.[s.id as keyof typeof completedSteps] ?? false;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setCurrentStep(i)}
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs transition-colors ${
                i === currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-green-500 bg-green-500/10 text-green-600"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            {step.icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{step.title}</h2>
            <p className="text-sm text-muted-foreground">{step.description}</p>
          </div>
        </div>

        {isCompleted && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2 text-sm text-green-600">
            <Check className="h-4 w-4" />
            This step is already complete.
          </div>
        )}

        <div className="mt-6">
          {/* Step 1: Connect GitHub */}
          {currentStep === 0 && (
            <Button onClick={handleConnectGitHub} className="w-full">
              <Github className="mr-2 h-4 w-4" />
              Install GitHub App
            </Button>
          )}

          {/* Step 2: Invite team */}
          {currentStep === 1 && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="invite-email" className="sr-only">
                    Email
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleInvite();
                      }
                    }}
                    disabled={inviting}
                  />
                </div>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Invite"
                  )}
                </Button>
              </div>
              {invitedEmails.length > 0 && (
                <div className="space-y-1">
                  {invitedEmails.map((email) => (
                    <div
                      key={email}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="h-3.5 w-3.5 text-green-500" />
                      {email}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Choose plan */}
          {currentStep === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  name: "Free",
                  price: "$0",
                  features: ["1 member", "Basic sessions"],
                },
                {
                  name: "Pro",
                  price: "$20/mo",
                  features: ["Unlimited members", "Priority support"],
                },
              ].map((plan) => (
                <button
                  key={plan.name}
                  type="button"
                  onClick={() =>
                    router.push(`/t/${tenantSlug}/settings/billing`)
                  }
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <div className="text-sm font-medium">{plan.name}</div>
                  <div className="text-lg font-semibold">{plan.price}</div>
                  <ul className="mt-2 space-y-1">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Check className="h-3 w-3" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          )}

          {/* Step 4: Start building */}
          {currentStep === 3 && (
            <Button
              onClick={() => router.push(`/t/${tenantSlug}`)}
              className="w-full"
            >
              <Terminal className="mr-2 h-4 w-4" />
              Create your first session
            </Button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={goNext}
          className="text-muted-foreground"
        >
          <SkipForward className="mr-1.5 h-3.5 w-3.5" />
          Skip
        </Button>
        <Button onClick={goNext} size="sm">
          {currentStep === totalSteps - 1 ? "Finish" : "Next"}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
