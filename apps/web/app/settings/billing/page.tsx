import type { Metadata } from "next";
import { BillingSection } from "./billing-section";

export const metadata: Metadata = {
  title: "Billing",
  description: "Manage your Open Agents plan, usage, and billing.",
};

export default function BillingPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <BillingSection />
    </>
  );
}
