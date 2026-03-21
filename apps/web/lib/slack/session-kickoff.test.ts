import { beforeEach, describe, expect, mock, test } from "bun:test";

const postCalls: string[] = [];
const eventLog: string[] = [];

let linkedAccount:
  | {
      id: string;
      userId: string;
    }
  | undefined;
let userRecord: {
  id: string;
  username: string;
  name: string | null;
} | null = null;
let createdSession = {
  session: { id: "session-1" },
  chat: { id: "chat-1" },
};
let startChatRunError: Error | null = null;

class MockStatusError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const postMock = mock(async (message: string) => {
  postCalls.push(message);
});

mock.module("./request-context", () => ({
  getSlackRequestBaseUrl: () => "https://app.test",
}));

mock.module("./link-token", () => ({
  createSlackLinkToken: async () => "token-123",
  buildSlackLinkUrl: ({ baseUrl, token }: { baseUrl: string; token: string }) =>
    `${baseUrl}/api/slack/link?token=${token}`,
}));

mock.module("@/lib/db/linked-accounts", () => ({
  getLinkedAccountByProviderAndExternalId: async () => linkedAccount,
}));

mock.module("@/lib/db/users", () => ({
  getUserById: async () => userRecord,
}));

mock.module("@/lib/sessions/create-session-for-user", () => ({
  CreateSessionForUserError: MockStatusError,
  createSessionForUser: async () => {
    eventLog.push("createSession");
    return createdSession;
  },
}));

mock.module("@/lib/db/chat-external-replies", () => ({
  upsertChatExternalReply: async () => {
    eventLog.push("upsertReply");
  },
  markPendingChatExternalReplyFailed: async () => {
    eventLog.push("markReplyFailed");
  },
}));

mock.module("@/lib/sandbox/create-session-sandbox", () => ({
  CreateSessionSandboxError: MockStatusError,
  createSessionSandboxForUser: async () => {
    eventLog.push("createSandbox");
  },
}));

mock.module("@/lib/chat/start-chat-run", () => ({
  StartChatRunError: MockStatusError,
  startChatRun: async () => {
    eventLog.push("startChat");
    if (startChatRunError) {
      throw startChatRunError;
    }
    return {
      status: "started",
      runId: "run-1",
      readable: new ReadableStream(),
    };
  },
}));

const modulePromise = import("./session-kickoff");

function createThread() {
  return {
    id: "slack:C123:1710000000.123456",
    post: async (message: string) => {
      eventLog.push(
        message.startsWith("Started a new Open Harness session:")
          ? "postLink"
          : "postOther",
      );
      return postMock(message);
    },
  };
}

function createMessage(text: string) {
  return {
    text,
    raw: {
      team_id: "T123",
    },
    author: {
      userId: "U123",
    },
  };
}

describe("handleSlackMention", () => {
  beforeEach(() => {
    postCalls.length = 0;
    eventLog.length = 0;
    linkedAccount = undefined;
    userRecord = {
      id: "user-1",
      username: "nico",
      name: "Nico",
    };
    createdSession = {
      session: { id: "session-1" },
      chat: { id: "chat-1" },
    };
    startChatRunError = null;
    postMock.mockClear();
  });

  test("posts a link request when the Slack user is not linked", async () => {
    const { handleSlackMention } = await modulePromise;

    await handleSlackMention(
      createThread() as never,
      createMessage("repo=vercel/ai Fix the tests") as never,
    );

    expect(postCalls).toEqual([
      "Before I can start a session, link your Slack account to Open Harness: https://app.test/api/slack/link?token=token-123",
    ]);
    expect(eventLog).toEqual(["postOther"]);
  });

  test("posts a syntax error for invalid repo input", async () => {
    const { handleSlackMention } = await modulePromise;

    linkedAccount = { id: "linked-1", userId: "user-1" };

    await handleSlackMention(
      createThread() as never,
      createMessage("please fix the tests") as never,
    );

    expect(postCalls).toEqual([
      "Use repo=owner/repo#branch <prompt>. Omit #branch to create a new branch.",
    ]);
    expect(eventLog).toEqual(["postOther"]);
  });

  test("creates the session, posts the link, then starts sandbox and chat", async () => {
    const { handleSlackMention } = await modulePromise;

    linkedAccount = { id: "linked-1", userId: "user-1" };

    await handleSlackMention(
      createThread() as never,
      createMessage("repo=vercel/ai#main Fix the tests") as never,
    );

    expect(postCalls).toEqual([
      "Started a new Open Harness session: https://app.test/sessions/session-1/chats/chat-1\nI'll post the first run's final response here when it's ready.",
    ]);
    expect(eventLog).toEqual([
      "createSession",
      "upsertReply",
      "postLink",
      "createSandbox",
      "startChat",
    ]);
  });

  test("marks the Slack reply as failed and posts an error if chat startup fails", async () => {
    const { handleSlackMention } = await modulePromise;

    linkedAccount = { id: "linked-1", userId: "user-1" };
    startChatRunError = new Error("Boom");

    await handleSlackMention(
      createThread() as never,
      createMessage("repo=vercel/ai#main Fix the tests") as never,
    );

    expect(eventLog).toEqual([
      "createSession",
      "upsertReply",
      "postLink",
      "createSandbox",
      "startChat",
      "markReplyFailed",
      "postOther",
    ]);
    expect(postCalls[1]).toBe(
      "I hit an error starting the session: Boom\nYou can inspect it here: https://app.test/sessions/session-1/chats/chat-1",
    );
  });
});
