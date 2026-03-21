import type { WebAgentUIMessage } from "@/app/types";
import {
  claimPendingChatExternalReply,
  completeClaimedChatExternalReply,
  failClaimedChatExternalReply,
} from "@/lib/db/chat-external-replies";
import { getSlackAdapter, isSlackConfigured } from "./bot";

const SLACK_REPLY_MAX_LENGTH = 35_000;

function extractAssistantText(message: WebAgentUIMessage): string {
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
}

function buildSlackReplyText(
  message: WebAgentUIMessage,
  chatUrl: string,
): string {
  const text = extractAssistantText(message);
  if (text.length === 0) {
    return `The run finished. View it in Open Harness: ${chatUrl}`;
  }

  if (text.length <= SLACK_REPLY_MAX_LENGTH) {
    return text;
  }

  const suffix = `\n\n[truncated — open the chat for full output]\n${chatUrl}`;
  return `${text.slice(0, SLACK_REPLY_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

export async function postSlackReplyForChat(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  const replyTarget = await claimPendingChatExternalReply(chatId);
  if (!replyTarget) {
    return;
  }

  if (!isSlackConfigured()) {
    await failClaimedChatExternalReply(chatId);
    return;
  }

  const slack = getSlackAdapter();
  const threadId = `slack:${replyTarget.channelId}:${replyTarget.threadTs}`;
  const replyText = buildSlackReplyText(message, replyTarget.chatUrl);

  try {
    const installation = await slack.getInstallation(replyTarget.workspaceId);
    if (installation) {
      await slack.withBotToken(installation.botToken, async () => {
        await slack.postMessage(threadId, replyText);
      });
    } else {
      await slack.postMessage(threadId, replyText);
    }

    await completeClaimedChatExternalReply(chatId);
  } catch (error) {
    console.error("Failed to post Slack reply:", error);
    await failClaimedChatExternalReply(chatId);
  }
}
