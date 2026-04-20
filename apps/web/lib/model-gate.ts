import "server-only";

import {
  getPlan,
  isModelAllowedByTier,
  PLAN_MATRIX,
  PlanUpgradeRequired,
  type PlanFeature,
} from "@/lib/billing";
import type { TenantContext } from "@/lib/db/tenant-context";
import { getActiveKey } from "@/lib/db/tenant-api-keys";
import { providerForModel } from "@/lib/provider-pricing";

/**
 * Assert that `modelId` is allowed for the tenant's current plan.
 *
 * Bypass: if the tenant has a BYO API key for the model's provider, the
 * model is allowed regardless of plan tier (the tenant pays their own
 * provider costs).
 *
 * Throws `PlanUpgradeRequired` with feature `model:<modelId>` when the
 * model is not included in the plan and no BYO key exists.
 */
export async function assertModelAllowed(
  ctx: Pick<TenantContext, "tenantId">,
  modelId: string,
): Promise<void> {
  const plan = await getPlan(ctx);
  const tier = PLAN_MATRIX[plan].models;

  if (isModelAllowedByTier(modelId, tier)) {
    return;
  }

  // BYO key override: if the tenant has configured their own key for
  // this model's provider, allow the model unconditionally.
  const provider = providerForModel(modelId);
  if (provider) {
    const key = await getActiveKey(ctx, provider);
    if (key) {
      return;
    }
  }

  const feature: PlanFeature = `model:${modelId}`;
  throw new PlanUpgradeRequired(feature, plan);
}
