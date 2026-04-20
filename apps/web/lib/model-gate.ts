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

/**
 * Filter a model list to only those the tenant's plan (or BYO keys) permit.
 *
 * Same logic as `assertModelAllowed` but non-throwing: models that would be
 * rejected are simply omitted. For each model not included in the plan's
 * tier, we check whether the tenant has a BYO API key for the model's
 * provider — if so, the model is kept.
 *
 * Returns `{ models, plan }` so callers can surface the plan to the client.
 */
export async function filterAllowedModels<T extends { id: string }>(
  ctx: Pick<TenantContext, "tenantId">,
  models: T[],
): Promise<{ models: T[]; plan: import("@/lib/billing").Plan }> {
  const plan = await getPlan(ctx);
  const tier = PLAN_MATRIX[plan].models;

  // Fast path: "all" tier allows everything.
  if (tier === "all") {
    return { models, plan };
  }

  // Pre-resolve which providers have BYO keys so we don't query per-model.
  const providerSet = new Set(
    models
      .filter((m) => !isModelAllowedByTier(m.id, tier))
      .map((m) => providerForModel(m.id))
      .filter((p): p is NonNullable<typeof p> => p != null),
  );

  const byoProviders = new Set<string>();
  await Promise.all(
    [...providerSet].map(async (provider) => {
      const key = await getActiveKey(ctx, provider);
      if (key) byoProviders.add(provider);
    }),
  );

  const filtered = models.filter((m) => {
    if (isModelAllowedByTier(m.id, tier)) return true;
    const provider = providerForModel(m.id);
    return provider != null && byoProviders.has(provider);
  });

  return { models: filtered, plan };
}
