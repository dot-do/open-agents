import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import { StartChatRunError, startChatRun } from "@/lib/chat/start-chat-run";
import { requireAuthenticatedUser } from "./_lib/chat-context";
import { persistAssistantMessagesWithToolResults } from "./_lib/persist-tool-results";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";

export const maxDuration = 800;

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { messages } = parsedBody.body;
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;

  void persistAssistantMessagesWithToolResults(chatId, messages);

  try {
    const result = await startChatRun({
      userId,
      sessionId,
      chatId,
      messages,
    });

    const stream = createCancelableReadableStream(
      result.readable as ReadableStream<WebAgentUIMessageChunk>,
    );

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "x-workflow-run-id": result.runId,
      },
    });
  } catch (error) {
    if (error instanceof StartChatRunError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
