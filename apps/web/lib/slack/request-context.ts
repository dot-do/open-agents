import { AsyncLocalStorage } from "node:async_hooks";

type SlackRequestContext = {
  baseUrl: string;
};

const slackRequestContextStore = new AsyncLocalStorage<SlackRequestContext>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function runWithSlackRequestContext<T>(
  context: SlackRequestContext,
  fn: () => T,
): T {
  return slackRequestContextStore.run(
    { baseUrl: normalizeBaseUrl(context.baseUrl) },
    fn,
  );
}

export function getSlackRequestBaseUrl(): string {
  const contextualBaseUrl = slackRequestContextStore.getStore()?.baseUrl;
  if (contextualBaseUrl) {
    return contextualBaseUrl;
  }

  const envBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (envBaseUrl) {
    return normalizeBaseUrl(envBaseUrl);
  }

  throw new Error("Slack request base URL is unavailable");
}
