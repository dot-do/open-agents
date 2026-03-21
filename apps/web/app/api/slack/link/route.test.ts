import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: {
  user: {
    id: string;
    username: string;
  };
} | null = null;
let parsedToken: {
  provider: "slack";
  externalId: string;
  workspaceId: string;
} | null = null;
let ensureResult:
  | {
      status: "created" | "existing" | "conflict";
      account: { id: string; userId: string };
    }
  | Error = {
  status: "created",
  account: { id: "linked-1", userId: "user-1" },
};
const ensureCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/slack/link-token", () => ({
  parseSlackLinkToken: async () => parsedToken,
}));

mock.module("@/lib/db/linked-accounts", () => ({
  ensureLinkedAccountForUser: async (input: Record<string, unknown>) => {
    ensureCalls.push(input);
    if (ensureResult instanceof Error) {
      throw ensureResult;
    }
    return ensureResult;
  },
}));

const routeModulePromise = import("./route");

function createRequest(token = "token-123") {
  return new Request(`http://localhost/api/slack/link?token=${token}`);
}

describe("GET /api/slack/link", () => {
  beforeEach(() => {
    currentSession = null;
    parsedToken = {
      provider: "slack",
      externalId: "U123",
      workspaceId: "T123",
    };
    ensureResult = {
      status: "created",
      account: { id: "linked-1", userId: "user-1" },
    };
    ensureCalls.length = 0;
  });

  test("redirects unauthenticated users to sign in", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest("abc"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost/api/auth/signin/vercel?next=%2Fapi%2Fslack%2Flink%3Ftoken%3Dabc",
    );
  });

  test("returns a 400 page for invalid or expired tokens", async () => {
    const { GET } = await routeModulePromise;

    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
      },
    };
    parsedToken = null;

    const response = await GET(createRequest());
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Invalid Slack link");
    expect(ensureCalls).toHaveLength(0);
  });

  test("returns a 409 page when the Slack account is already linked elsewhere", async () => {
    const { GET } = await routeModulePromise;

    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
      },
    };
    ensureResult = {
      status: "conflict",
      account: { id: "linked-2", userId: "user-2" },
    };

    const response = await GET(createRequest());
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain("Slack account already linked");
    expect(ensureCalls[0]).toMatchObject({
      userId: "user-1",
      provider: "slack",
      externalId: "U123",
      workspaceId: "T123",
    });
  });

  test("returns a success page when the link succeeds", async () => {
    const { GET } = await routeModulePromise;

    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
      },
    };

    const response = await GET(createRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Slack account linked");
    expect(ensureCalls[0]).toMatchObject({
      userId: "user-1",
      provider: "slack",
      externalId: "U123",
      workspaceId: "T123",
    });
  });
});
