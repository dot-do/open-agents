import { nanoid } from "nanoid";
import type { Message, Thread } from "chat";
import type { WebAgentUIMessage } from "@/app/types";
import {
  markPendingChatExternalReplyFailed,
  upsertChatExternalReply,
} from "@/lib/db/chat-external-replies";
import { getLinkedAccountByProviderAndExternalId } from "@/lib/db/linked-accounts";
import { getUserById } from "@/lib/db/users";
import {
  CreateSessionForUserError,
  createSessionForUser,
} from "@/lib/sessions/create-session-for-user";
import {
  CreateSessionSandboxError,
  createSessionSandboxForUser,
} from "@/lib/sandbox/create-session-sandbox";
import { StartChatRunError, startChatRun } from "@/lib/chat/start-chat-run";
import { buildSlackLinkUrl, createSlackLinkToken } from "./link-token";
import { getSlackRequestBaseUrl } from "./request-context";
import { parseSlackRepoKickoff } from "./repo-parser";

type SlackRawMessage = {
  team?: unknown;
  team_id?: unknown;
};

function getWorkspaceIdFromRawMessage(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as SlackRawMessage;
  if (typeof candidate.team_id === "string" && candidate.team_id.length > 0) {
    return candidate.team_id;
  }

  if (typeof candidate.team === "string" && candidate.team.length > 0) {
    return candidate.team;
  }

  return null;
}

function parseSlackThreadId(threadId: string): {
  channelId: string;
  threadTs: string;
} | null {
  const [adapter, channelId, ...rest] = threadId.split(":");
  const threadTs = rest.join(":");
  if (adapter !== "slack" || !channelId || !threadTs) {
    return null;
  }

  return { channelId, threadTs };
}

function buildChatUrl(params: {
  baseUrl: string;
  sessionId: string;
  chatId: string;
}) {
  return new URL(
    `/sessions/${params.sessionId}/chats/${params.chatId}`,
    params.baseUrl,
  ).toString();
}

function buildUserMessage(prompt: string): WebAgentUIMessage {
  return {
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  } as WebAgentUIMessage;
}

function getErrorMessage(error: unknown): string {
  if (
    error instanceof CreateSessionForUserError ||
    error instanceof CreateSessionSandboxError ||
    error instanceof StartChatRunError
  ) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Failed to start the session.";
}

export async function handleSlackMention(
  thread: Thread,
  message: Message,
): Promise<void> {
  try {
    const baseUrl = getSlackRequestBaseUrl();
    const workspaceId = getWorkspaceIdFromRawMessage(message.raw);
    if (!workspaceId) {
      await thread.post(
        "I couldn't determine your Slack workspace. Please try again.",
      );
      return;
    }

    const externalId = message.author.userId;
    if (!externalId) {
      await thread.post(
        "I couldn't determine your Slack user identity. Please try again.",
      );
      return;
    }

    const linkedAccount = await getLinkedAccountByProviderAndExternalId(
      "slack",
      externalId,
      workspaceId,
    );
    if (!linkedAccount) {
      const token = await createSlackLinkToken({
        provider: "slack",
        externalId,
        workspaceId,
      });
      const linkUrl = buildSlackLinkUrl({ baseUrl, token });
      await thread.post(
        `Before I can start a session, link your Slack account to Open Harness: ${linkUrl}`,
      );
      return;
    }

    const parsedKickoff = parseSlackRepoKickoff(message.text);
    if (!parsedKickoff.ok) {
      await thread.post(parsedKickoff.error.message);
      return;
    }

    const user = await getUserById(linkedAccount.userId);
    if (!user) {
      await thread.post(
        "Your Slack account link is stale. Sign in to Open Harness and try again.",
      );
      return;
    }

    const threadInfo = parseSlackThreadId(thread.id);
    if (!threadInfo) {
      await thread.post("I couldn't determine which Slack thread to reply to.");
      return;
    }

    const kickoff = parsedKickoff.value;
    const cloneUrl = `https://github.com/${kickoff.repoOwner}/${kickoff.repoName}`;

    try {
      const { session, chat } = await createSessionForUser({
        userId: user.id,
        username: user.username,
        name: user.name,
        repoOwner: kickoff.repoOwner,
        repoName: kickoff.repoName,
        branch: kickoff.branch ?? undefined,
        cloneUrl,
        isNewBranch: kickoff.isNewBranch,
      });

      const chatUrl = buildChatUrl({
        baseUrl,
        sessionId: session.id,
        chatId: chat.id,
      });

      await upsertChatExternalReply({
        chatId: chat.id,
        provider: "slack",
        workspaceId,
        channelId: threadInfo.channelId,
        threadTs: threadInfo.threadTs,
        chatUrl,
      });

      await thread.post(
        `Started a new Open Harness session: ${chatUrl}\nI'll post the first run's final response here when it's ready.`,
      );

      try {
        await createSessionSandboxForUser({
          userId: user.id,
          sessionId: session.id,
        });

        await startChatRun({
          userId: user.id,
          sessionId: session.id,
          chatId: chat.id,
          messages: [buildUserMessage(kickoff.prompt)],
        });
      } catch (error) {
        await markPendingChatExternalReplyFailed(chat.id);
        await thread.post(
          `I hit an error starting the session: ${getErrorMessage(error)}\nYou can inspect it here: ${chatUrl}`,
        );
      }
    } catch (error) {
      await thread.post(
        `I couldn't create the session: ${getErrorMessage(error)}`,
      );
    }
  } catch (error) {
    console.error("Failed to handle Slack mention:", error);
    await thread.post(
      "I hit an unexpected error while handling your request. Please try again.",
    );
  }
}
