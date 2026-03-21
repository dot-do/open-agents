import { type InferUIMessageChunk } from "ai";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { runAgentWorkflow } from "@/app/workflows/chat";
import { createChatRuntime } from "@/app/api/chat/_lib/runtime";
import { resolveChatModelSelection } from "@/app/api/chat/_lib/model-selection";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  getSessionById,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateSession,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getAllVariants } from "@/lib/model-variants";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";

export type StartChatRunResult = {
  status: "started" | "reconnected";
  runId: string;
  readable: ReadableStream<InferUIMessageChunk<WebAgentUIMessage>>;
};

export class StartChatRunError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StartChatRunError";
    this.status = status;
  }
}

export async function startChatRun(params: {
  userId: string;
  sessionId: string;
  chatId: string;
  messages: WebAgentUIMessage[];
}): Promise<StartChatRunResult> {
  if (params.messages.length === 0) {
    throw new StartChatRunError("At least one message is required", 400);
  }

  const [sessionRecord, chat] = await Promise.all([
    getSessionById(params.sessionId),
    getChatById(params.chatId),
  ]);

  if (!sessionRecord) {
    throw new StartChatRunError("Session not found", 404);
  }

  if (sessionRecord.userId !== params.userId) {
    throw new StartChatRunError("Unauthorized", 403);
  }

  if (!chat || chat.sessionId !== params.sessionId) {
    throw new StartChatRunError("Chat not found", 404);
  }

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    throw new StartChatRunError("Sandbox not initialized", 400);
  }

  const activeSandboxState = sessionRecord.sandboxState;
  if (!activeSandboxState) {
    throw new StartChatRunError("Sandbox not initialized", 400);
  }

  if (chat.activeStreamId) {
    try {
      const { getRun } = await import("workflow/api");
      const existingRun = getRun(chat.activeStreamId);
      const status = await existingRun.status;
      if (status === "running" || status === "pending") {
        return {
          status: "reconnected",
          runId: chat.activeStreamId,
          readable:
            existingRun.getReadable<InferUIMessageChunk<WebAgentUIMessage>>(),
        };
      }
    } catch {
      // Workflow not found or inaccessible — proceed with new workflow.
    }
  }

  const requestStartedAt = new Date();
  await updateSession(params.sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  await persistLatestUserMessage(params.chatId, params.messages);

  const runtimePromise = createChatRuntime({
    userId: params.userId,
    sessionId: params.sessionId,
    sessionRecord,
  });
  const preferencesPromise = getUserPreferences(params.userId).catch(
    (error) => {
      console.error("Failed to load user preferences:", error);
      return null;
    },
  );

  const [{ sandbox, skills }, preferences] = await Promise.all([
    runtimePromise,
    preferencesPromise,
  ]);

  const modelVariants = getAllVariants(preferences?.modelVariants ?? []);
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId: chat.modelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;

  const shouldAutoCommitPush =
    sessionRecord.autoCommitPushOverride ??
    preferences?.autoCommitPush ??
    false;

  const run = await start(runAgentWorkflow, [
    {
      messages: params.messages,
      chatId: params.chatId,
      sessionId: params.sessionId,
      userId: params.userId,
      modelId: mainModelSelection.id,
      maxSteps: 500,
      agentOptions: {
        sandbox: {
          state: activeSandboxState,
          workingDirectory: sandbox.workingDirectory,
          currentBranch: sandbox.currentBranch,
          environmentDetails: sandbox.environmentDetails,
        },
        model: mainModelSelection,
        ...(subagentModelSelection
          ? { subagentModel: subagentModelSelection }
          : {}),
        ...(skills.length > 0 && { skills }),
      },
      ...(shouldAutoCommitPush &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName && {
          autoCommitEnabled: true,
          sessionTitle: sessionRecord.title,
          repoOwner: sessionRecord.repoOwner,
          repoName: sessionRecord.repoName,
        }),
    },
  ]);

  const claimed = await compareAndSetChatActiveStreamId(
    params.chatId,
    null,
    run.runId,
  );

  if (!claimed) {
    try {
      const { getRun } = await import("workflow/api");
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cleanup.
    }

    throw new StartChatRunError(
      "Another workflow is already running for this chat",
      409,
    );
  }

  return {
    status: "started",
    runId: run.runId,
    readable: run.getReadable<InferUIMessageChunk<WebAgentUIMessage>>(),
  };
}

async function persistLatestUserMessage(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "user") {
    return;
  }

  try {
    const created = await createChatMessageIfNotExists({
      id: latestMessage.id,
      chatId,
      role: "user",
      parts: latestMessage,
    });

    if (!created) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id);
    if (!shouldSetTitle) {
      return;
    }

    const textContent = latestMessage.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length > 0) {
      const title =
        textContent.length > 30
          ? `${textContent.slice(0, 30)}...`
          : textContent;
      await updateChat(chatId, { title });
    }
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }
}
