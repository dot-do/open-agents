/**
 * Next.js instrumentation entrypoint. Runs once per server process before any
 * request is handled. We use it to bootstrap the OpenTelemetry Node SDK when —
 * and only when — an OTLP endpoint is configured. If the env is unset the SDK
 * is never started and there is zero runtime cost; `withTenantTags` falls back
 * to its JSON log shim.
 *
 * Env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — base OTLP HTTP endpoint (required to enable)
 *   OTEL_EXPORTER_OTLP_HEADERS   — comma-separated k=v pairs (optional)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  const { Resource } = await import("@opentelemetry/resources");
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
  } = await import("@opentelemetry/semantic-conventions");

  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: "open-agents-web",
      [ATTR_SERVICE_VERSION]: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      headers,
    }),
  });
  sdk.start();
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
