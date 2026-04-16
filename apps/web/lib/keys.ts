import type { LanguageModel } from "ai";
import { createGateway, gateway as defaultGateway } from "ai";
import type { TenantContext } from "@/lib/db/tenant-context";
import {
  getActiveKey,
  type TenantApiKeyProvider,
} from "@/lib/db/tenant-api-keys";

/**
 * Provider key resolution for tenant BYOK + platform fallback.
 *
 * Used at every provider-client construction site so model invocations
 * prefer tenant-supplied keys and fall back to platform env vars (for
 * billback). Never logs plaintext.
 */

export type KeySource = "tenant" | "platform";

export type ResolvedProviderKey = {
  apiKey: string;
  source: KeySource;
  provider: TenantApiKeyProvider;
  tenantKeyId?: string;
};

const PLATFORM_ENV: Record<TenantApiKeyProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gateway: "AI_GATEWAY_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
};

export async function resolveProviderKey(
  ctx: Pick<TenantContext, "tenantId"> | null | undefined,
  provider: TenantApiKeyProvider,
): Promise<ResolvedProviderKey | null> {
  if (ctx?.tenantId) {
    const tenantKey = await getActiveKey(ctx, provider);
    if (tenantKey) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "tenant.key.used",
          "key.source": "tenant",
          provider,
          tenantId: ctx.tenantId,
          keyId: tenantKey.id,
        }),
      );
      return {
        apiKey: tenantKey.plaintext,
        source: "tenant",
        provider,
        tenantKeyId: tenantKey.id,
      };
    }
  }

  const envName = PLATFORM_ENV[provider];
  const platform = envName ? process.env[envName] : undefined;
  if (platform) {
    // Structured log line for billback accounting.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "tenant.key.fallback",
        "key.source": "platform",
        provider,
        tenantId: ctx?.tenantId ?? null,
      }),
    );
    return { apiKey: platform, source: "platform", provider };
  }

  return null;
}

/**
 * Resolve a gateway-backed LanguageModel, preferring a tenant-supplied
 * gateway (or anthropic/openai) key and falling back to the platform default.
 *
 * This is the primary call-site helper: replace `gateway("model/id")` with
 * `await resolveGatewayModel(ctx, "model/id")` and key selection + fallback
 * logging is handled for you.
 */
export async function resolveGatewayModel(
  ctx: Pick<TenantContext, "tenantId"> | null | undefined,
  modelId: string,
): Promise<LanguageModel> {
  // Prefer a tenant-scoped gateway key; this is the cleanest integration
  // because the gateway proxies all providers. If absent, fall back to the
  // platform gateway singleton (which uses AI_GATEWAY_API_KEY).
  const resolved = await resolveProviderKey(ctx, "gateway");
  if (resolved && resolved.source === "tenant") {
    const g = createGateway({ apiKey: resolved.apiKey });
    return g(modelId);
  }
  return defaultGateway(modelId);
}

