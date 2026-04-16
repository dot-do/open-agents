import "server-only";

/**
 * Per-provider, per-model token pricing (USD per 1M tokens).
 *
 * Source notes (2026-04, public pricing pages):
 *   - Anthropic claude-opus-4.x   : $15 input / $75 output per 1M tokens.
 *   - Anthropic claude-sonnet-4.x : $3 input / $15 output per 1M tokens.
 *   - Anthropic claude-haiku-4.x  : $0.80 input / $4 output per 1M tokens.
 *   - OpenAI gpt-5.x / gpt-4o     : $5 input / $15 output per 1M tokens (rough).
 *   - OpenAI gpt-4o-mini / gpt-5-mini: $0.15 input / $0.60 output per 1M.
 *   - Google gemini-1.5-pro       : $3.50 input / $10.50 output per 1M.
 *   - xAI grok-2 / grok-3         : $5 input / $15 output per 1M (approx).
 *
 * These are approximate; the goal is to keep per-provider spend caps
 * accurate enough for hard-stop enforcement, NOT for invoicing. Real
 * billing flows through Stripe metering with token counts; this table
 * is only used by the per-provider daily cap enforcement path.
 *
 * Format: USD per 1M tokens. Cents conversion happens at the call site.
 */
export interface ProviderModelPricing {
  /** Input tokens (uncached) — USD per 1M. */
  inputUsdPerMillion: number;
  /** Output tokens — USD per 1M. */
  outputUsdPerMillion: number;
  /** Cached input tokens — USD per 1M. Defaults to 10% of input price. */
  cachedInputUsdPerMillion?: number;
}

export type Provider = "anthropic" | "openai" | "google" | "xai" | "gateway";

/**
 * Maps lowercased model id substrings to provider. The order matters —
 * more-specific patterns should come first.
 */
const MODEL_PROVIDER_PATTERNS: Array<{ pattern: RegExp; provider: Provider }> = [
  { pattern: /^anthropic\//, provider: "anthropic" },
  { pattern: /^openai\//, provider: "openai" },
  { pattern: /^google\//, provider: "google" },
  { pattern: /^xai\//, provider: "xai" },
  { pattern: /^gemini/, provider: "google" },
  { pattern: /^claude/, provider: "anthropic" },
  { pattern: /^gpt-/, provider: "openai" },
  { pattern: /^o[0-9]/, provider: "openai" },
  { pattern: /^grok/, provider: "xai" },
];

/**
 * Per-model pricing rows. Keys are matched against the lowercased model id
 * via `includes` so e.g. `anthropic/claude-opus-4.6` matches `claude-opus`.
 */
const PRICING: Array<{
  match: string;
  provider: Provider;
  pricing: ProviderModelPricing;
}> = [
  // Anthropic — Claude 4.x family.
  {
    match: "claude-opus",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillion: 15,
      outputUsdPerMillion: 75,
      cachedInputUsdPerMillion: 1.5,
    },
  },
  {
    match: "claude-sonnet",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      cachedInputUsdPerMillion: 0.3,
    },
  },
  {
    match: "claude-haiku",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 4,
      cachedInputUsdPerMillion: 0.08,
    },
  },
  // OpenAI — gpt-5.x / gpt-4o family (rough).
  {
    match: "gpt-5-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
    },
  },
  {
    match: "gpt-4o-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
    },
  },
  {
    match: "gpt-5",
    provider: "openai",
    pricing: {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 15,
    },
  },
  {
    match: "gpt-4o",
    provider: "openai",
    pricing: {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 15,
    },
  },
  {
    match: "gpt-4",
    provider: "openai",
    pricing: {
      inputUsdPerMillion: 10,
      outputUsdPerMillion: 30,
    },
  },
  // Google
  {
    match: "gemini-1.5-pro",
    provider: "google",
    pricing: {
      inputUsdPerMillion: 3.5,
      outputUsdPerMillion: 10.5,
    },
  },
  {
    match: "gemini",
    provider: "google",
    pricing: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 3,
    },
  },
  // xAI
  {
    match: "grok",
    provider: "xai",
    pricing: {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 15,
    },
  },
];

/**
 * Pricing fallback when no entry matches — keeps the cap path conservative
 * (we'd rather over-attribute than miss spend).
 */
const FALLBACK_PRICING: ProviderModelPricing = {
  inputUsdPerMillion: 5,
  outputUsdPerMillion: 15,
};

/**
 * Best-effort provider lookup from a model id.
 *
 * Examples:
 *   - "anthropic/claude-opus-4.6" -> "anthropic"
 *   - "openai/gpt-5"              -> "openai"
 *   - "claude-sonnet-4.5"         -> "anthropic"
 *
 * Returns `null` when the provider cannot be inferred so callers can
 * choose to skip per-provider attribution rather than mis-attribute.
 */
export function providerForModel(modelId: string): Provider | null {
  const lowered = modelId.toLowerCase();
  for (const { pattern, provider } of MODEL_PROVIDER_PATTERNS) {
    if (pattern.test(lowered)) {
      return provider;
    }
  }
  return null;
}

/**
 * Look up token pricing for a model id. Falls back to a conservative
 * default so the spend-cap path always returns a positive cost estimate.
 */
export function pricingForModel(modelId: string): {
  provider: Provider | null;
  pricing: ProviderModelPricing;
} {
  const lowered = modelId.toLowerCase();
  for (const row of PRICING) {
    if (lowered.includes(row.match)) {
      return { provider: row.provider, pricing: row.pricing };
    }
  }
  const provider = providerForModel(modelId);
  return { provider, pricing: FALLBACK_PRICING };
}

export interface TokenUsageForCost {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}

/**
 * Compute estimated cost in cents for a token-usage record. Uses the
 * model's pricing entry (or the fallback) and integer cents rounding.
 */
export function estimateCostCents(
  modelId: string,
  usage: TokenUsageForCost,
): { provider: Provider | null; costCents: number } {
  const { provider, pricing } = pricingForModel(modelId);
  const cachedInput = Math.max(0, usage.cachedInputTokens ?? 0);
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput);
  const output = Math.max(0, usage.outputTokens);
  const cachedRate =
    pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion * 0.1;

  const usd =
    (uncachedInput * pricing.inputUsdPerMillion) / 1_000_000 +
    (cachedInput * cachedRate) / 1_000_000 +
    (output * pricing.outputUsdPerMillion) / 1_000_000;

  // Round up so we never under-count; per-provider caps prefer slightly
  // conservative attribution to avoid silent overspend.
  const costCents = Math.max(0, Math.ceil(usd * 100));
  return { provider, costCents };
}
