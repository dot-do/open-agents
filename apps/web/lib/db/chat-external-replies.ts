import { and, eq } from "drizzle-orm";
import { db } from "./client";
import {
  chatExternalReplies,
  type ChatExternalReply,
  type NewChatExternalReply,
} from "./schema";

export async function upsertChatExternalReply(
  data: Omit<
    NewChatExternalReply,
    "createdAt" | "updatedAt" | "completedAt" | "status"
  >,
): Promise<ChatExternalReply> {
  const now = new Date();
  const [reply] = await db
    .insert(chatExternalReplies)
    .values({
      ...data,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    })
    .onConflictDoUpdate({
      target: chatExternalReplies.chatId,
      set: {
        provider: data.provider,
        workspaceId: data.workspaceId,
        channelId: data.channelId,
        threadTs: data.threadTs,
        chatUrl: data.chatUrl,
        status: "pending",
        updatedAt: now,
        completedAt: null,
      },
    })
    .returning();

  if (!reply) {
    throw new Error("Failed to upsert chat external reply");
  }

  return reply;
}

export async function claimPendingChatExternalReply(
  chatId: string,
): Promise<ChatExternalReply | null> {
  const [reply] = await db
    .update(chatExternalReplies)
    .set({
      status: "sending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatExternalReplies.chatId, chatId),
        eq(chatExternalReplies.status, "pending"),
      ),
    )
    .returning();

  return reply ?? null;
}

async function updateClaimedChatExternalReplyStatus(
  chatId: string,
  status: "completed" | "failed",
): Promise<void> {
  await db
    .update(chatExternalReplies)
    .set({
      status,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(chatExternalReplies.chatId, chatId),
        eq(chatExternalReplies.status, "sending"),
      ),
    );
}

export async function completeClaimedChatExternalReply(
  chatId: string,
): Promise<void> {
  await updateClaimedChatExternalReplyStatus(chatId, "completed");
}

export async function failClaimedChatExternalReply(
  chatId: string,
): Promise<void> {
  await updateClaimedChatExternalReplyStatus(chatId, "failed");
}

export async function markPendingChatExternalReplyFailed(
  chatId: string,
): Promise<void> {
  await db
    .update(chatExternalReplies)
    .set({
      status: "failed",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(chatExternalReplies.chatId, chatId),
        eq(chatExternalReplies.status, "pending"),
      ),
    );
}

export async function skipPendingChatExternalReply(
  chatId: string,
): Promise<void> {
  await db
    .update(chatExternalReplies)
    .set({
      status: "skipped",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(chatExternalReplies.chatId, chatId),
        eq(chatExternalReplies.status, "pending"),
      ),
    );
}
