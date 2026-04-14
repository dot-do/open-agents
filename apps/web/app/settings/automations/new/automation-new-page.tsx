"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AutomationForm } from "../automation-form";
import { useAutomations } from "@/hooks/use-automations";

export function AutomationNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { createAutomation } = useAutomations();

  const prefillInstructions = searchParams.get("instructions") ?? undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold">New Automation</h1>
      <AutomationForm
        initialValue={
          prefillInstructions
            ? { instructions: prefillInstructions }
            : undefined
        }
        submitLabel="Create automation"
        onSubmit={async (input) => {
          const automation = await createAutomation(input);
          router.push(`/settings/automations/${automation.id}`);
        }}
      />
    </>
  );
}
