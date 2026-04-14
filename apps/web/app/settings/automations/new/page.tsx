import type { Metadata } from "next";
import { Suspense } from "react";
import { AutomationNewPage } from "./automation-new-page";

export const metadata: Metadata = {
  title: "New Automation",
  description: "Create a new automation.",
};

export default function Page() {
  return (
    <Suspense>
      <AutomationNewPage />
    </Suspense>
  );
}
