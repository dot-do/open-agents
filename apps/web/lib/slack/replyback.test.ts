import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

let claimedReply: {
  chatId: string;
  channelId: string;
  threadTs: string;
  workspaceId: string;
  chatUrl: string;
} | null = null;
let postMessageError: Error | null = null;
const postCalls: Array<{ threadId: string; text: string }> = [];
const completeCalls: string[] = [];
const failCalls: string[] = [];

mock.module("@/lib/db/chat-external-replies", () => ({
  claimPendingChatExternalReply: async () => claimedReply,
  completeClaimedChatExternalReply: async (chatId: string) => {
    completeCalls.push(chatId);
  },
  failClaimedChatExternalReply: async (chatId: string) => {
    failCalls.push(chatId);
  },
}));

mock.module("./bot", () => ({
  isSlackConfigured: () => true,
  getSlackAdapter: () => ({
    getInstallation: async () => null,
    postMessage: async (threadId: string, text: string) => {
      if (postMessageError) {
        throw postMessageError;
      }
      postCalls.push({ threadId, text });
    },
  }),
}));

const modulePromise = import("./replyback");

function createAssistantMessage(text: string): WebAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text }],
  } as WebAgentUIMessage;
}

describe("postSlackReplyForChat", () => {
  beforeEach(() => {
    claimedReply = {
      chatId: "chat-1",
      channelId: "C123",
      threadTs: "1710000000.123456",
      workspaceId: "T123",
      chatUrl: "https://app.test/sessions/session-1/chats/chat-1",
    };
    postMessageError = null;
    postCalls.length = 0;
    completeCalls.length = 0;
    failCalls.length = 0;
  });

  test("posts the assistant text back to the Slack thread", async () => {
    const { postSlackReplyForChat } = await modulePromise;

    await postSlackReplyForChat(
      "chat-1",
      createAssistantMessage("Finished the work."),
    );

    expect(postCalls).toEqual([
      {
        threadId: "slack:C123:1710000000.123456",
        text: "Finished the work.",
      },
    ]);
    expect(completeCalls).toEqual(["chat-1"]);
    expect(failCalls).toEqual([]);
  });

  test("falls back to the chat URL when the assistant has no text", async () => {
    const { postSlackReplyForChat } = await modulePromise;

    await postSlackReplyForChat("chat-1", {
      id: "assistant-1",
      role: "assistant",
      parts: [],
    } as WebAgentUIMessage);

    expect(postCalls[0]).toEqual({
      threadId: "slack:C123:1710000000.123456",
      text: "The run finished. View it in Open Harness: https://app.test/sessions/session-1/chats/chat-1",
    });
    expect(completeCalls).toEqual(["chat-1"]);
  });

  test("marks the reply as failed when Slack posting throws", async () => {
    const { postSlackReplyForChat } = await modulePromise;

    postMessageError = new Error("boom");

    await postSlackReplyForChat(
      "chat-1",
      createAssistantMessage("Finished the work."),
    );

    expect(completeCalls).toEqual([]);
    expect(failCalls).toEqual(["chat-1"]);
  });
});
