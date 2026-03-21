import { decryptJWE } from "@/lib/jwe/decrypt";
import { encryptJWE } from "@/lib/jwe/encrypt";

export type SlackLinkTokenPayload = {
  provider: "slack";
  externalId: string;
  workspaceId: string;
};

export async function createSlackLinkToken(
  payload: SlackLinkTokenPayload,
): Promise<string> {
  return encryptJWE(payload, "30m");
}

export async function parseSlackLinkToken(
  token: string,
): Promise<SlackLinkTokenPayload | null> {
  const payload = await decryptJWE<Partial<SlackLinkTokenPayload>>(token);
  if (!payload) {
    return null;
  }

  if (
    payload.provider !== "slack" ||
    typeof payload.externalId !== "string" ||
    payload.externalId.length === 0 ||
    typeof payload.workspaceId !== "string" ||
    payload.workspaceId.length === 0
  ) {
    return null;
  }

  return {
    provider: "slack",
    externalId: payload.externalId,
    workspaceId: payload.workspaceId,
  };
}

export function buildSlackLinkUrl(params: {
  baseUrl: string;
  token: string;
}): string {
  const url = new URL("/api/slack/link", params.baseUrl);
  url.searchParams.set("token", params.token);
  return url.toString();
}
