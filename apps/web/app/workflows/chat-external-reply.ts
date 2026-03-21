import type { WebAgentUIMessage } from "@/app/types";
import { skipPendingChatExternalReply } from "@/lib/db/chat-external-replies";
import { postSlackReplyForChat } from "@/lib/slack/replyback";

export async function postSlackReplyIfPending(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";
  await postSlackReplyForChat(chatId, message);
}

export async function skipSlackReplyIfPending(chatId: string): Promise<void> {
  "use step";
  await skipPendingChatExternalReply(chatId);
}
