import { checkBotId } from "botid/server";
import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { botIdConfig } from "@/lib/botid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import {
  compareAndSetChatActiveStreamId,
  countUserMessagesByUserId,
  createChatMessageIfNotExists,
  getChatById,
  getChatMessageById,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateSession,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  filterModelVariantsForSession,
  sanitizeSelectedModelIdForSession,
  sanitizeUserPreferencesForSession,
} from "@/lib/model-access";
import { getAllVariants } from "@/lib/model-variants";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  isManagedTemplateTrialUser,
  MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT,
  MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT_ERROR,
} from "@/lib/managed-template-trial";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { resolveChatModelSelection } from "./_lib/model-selection";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { createChatRuntime } from "./_lib/runtime";
import { runAgentWorkflow } from "@/app/workflows/chat";
import { persistAssistantMessagesWithToolResults } from "./_lib/persist-tool-results";

export const maxDuration = 800;

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

function getLatestUserMessage(messages: WebAgentUIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return null;
}

export async function POST(req: Request) {
  // 1. Validate session
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;
  const session = await getServerSession();

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { messages } = parsedBody.body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;

  // 3. Verify session + chat ownership
  const chatContext = await requireOwnedSessionChat({
    userId,
    sessionId,
    chatId,
    tenantId: authResult.tenantId,
    forbiddenMessage: "Unauthorized",
    requireActiveSandbox: true,
    sandboxInactiveMessage: "Sandbox not initialized",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { sessionRecord, chat } = chatContext;
  const activeSandboxState = sessionRecord.sandboxState;
  if (!activeSandboxState) {
    throw new Error("Sandbox not initialized");
  }

  const tenantId = authResult.tenantId;

  if (isManagedTemplateTrialUser(session, req.url)) {
    const latestUserMessage = getLatestUserMessage(messages);
    if (latestUserMessage) {
      const existingMessage = await getChatMessageById(latestUserMessage.id, tenantId);
      if (!existingMessage) {
        const userMessageCount = await countUserMessagesByUserId(userId, tenantId);
        if (userMessageCount >= MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT) {
          return Response.json(
            { error: MANAGED_TEMPLATE_TRIAL_MESSAGE_LIMIT_ERROR },
            { status: 403 },
          );
        }
      }
    }
  }

  // Guard: if a workflow is already running for this chat, reconnect to it
  // instead of starting a duplicate. This prevents auto-submit from spawning
  // parallel workflows when the client sees completed tool calls mid-loop.
  if (chat.activeStreamId) {
    const existingStreamResolution = await reconcileExistingActiveStream(
      chatId,
      chat.activeStreamId,
      tenantId,
    );

    if (existingStreamResolution.action === "resume") {
      return createUIMessageStreamResponse({
        stream: existingStreamResolution.stream,
        headers: { "x-workflow-run-id": existingStreamResolution.runId },
      });
    }

    if (existingStreamResolution.action === "conflict") {
      return Response.json(
        { error: "Another workflow is already running for this chat" },
        { status: 409 },
      );
    }
  }

  const requestStartedAt = new Date();

  // Refresh lifecycle activity so long-running responses don't look idle.
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  }, tenantId);

  // Persist the latest user message immediately (fire-and-forget) so it's
  // in the DB before the workflow starts. This ensures a page refresh
  // during workflow queue time still shows the message.
  void persistLatestUserMessage(chatId, messages, tenantId);

  // Also persist any assistant messages that contain client-side tool results
  // (e.g. ask_user_question responses). Without this, tool results are only
  // persisted when the workflow finishes, so switching devices mid-stream
  // would lose the tool result.
  void persistAssistantMessagesWithToolResults(chatId, messages);

  const runtimePromise = createChatRuntime({
    userId,
    sessionId,
    sessionRecord,
  });
  const preferencesPromise = getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });

  const [{ sandbox, skills }, rawPreferences] = await Promise.all([
    runtimePromise,
    preferencesPromise,
  ]);

  const preferences = rawPreferences
    ? sanitizeUserPreferencesForSession(rawPreferences, session, req.url)
    : null;
  const modelVariants = filterModelVariantsForSession(
    getAllVariants(preferences?.modelVariants ?? []),
    session,
    req.url,
  );
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId: sanitizeSelectedModelIdForSession(
      chat.modelId,
      modelVariants,
      session,
      req.url,
    ),
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: sanitizeSelectedModelIdForSession(
          preferences.defaultSubagentModelId,
          modelVariants,
          session,
          req.url,
        ),
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;

  // Determine if auto-commit and auto-PR should run after a natural finish.
  const shouldAutoCommitPush =
    sessionRecord.autoCommitPushOverride ??
    preferences?.autoCommitPush ??
    false;
  const shouldAutoCreatePr =
    shouldAutoCommitPush &&
    (sessionRecord.autoCreatePrOverride ?? preferences?.autoCreatePr ?? false);

  // Pre-flight per-provider daily spend cap (Wave 6 / open-agents-lcc).
  // Block the request before the streaming workflow starts when the
  // tenant's per-provider cap is already exhausted. We surface this as
  // HTTP 402 with a structured `provider_spend_cap_reached` error so
  // the chat client can render a clear message rather than a 5xx.
  if (sessionRecord.tenantId) {
    try {
      const { providerForModel } = await import("@/lib/provider-pricing");
      const { assertProviderSpendUnderCap } = await import(
        "@/lib/quotas/provider-spend"
      );
      const provider = providerForModel(mainModelSelection.id);
      if (provider) {
        await assertProviderSpendUnderCap(sessionRecord.tenantId, provider);
      }
    } catch (error) {
      const { QuotaExceededError } = await import("@/lib/quotas");
      if (error instanceof QuotaExceededError) {
        const provider =
          (await import("@/lib/provider-pricing")).providerForModel(
            mainModelSelection.id,
          ) ?? "unknown";
        return Response.json(
          {
            error: "provider_spend_cap_reached",
            provider,
            limit: error.limit,
            current: error.current,
          },
          { status: 402 },
        );
      }
      // Non-quota errors here are best-effort: log and continue rather
      // than blocking the chat path on a Redis hiccup.
      console.warn(
        "[quotas] provider spend pre-flight failed:",
        error,
      );
    }
  }

  // Plan-gated model access: reject early if the model is not included in
  // the tenant's plan and no BYO key exists for the provider.
  if (tenantId) {
    try {
      const { assertModelAllowed } = await import("@/lib/model-gate");
      await assertModelAllowed({ tenantId }, mainModelSelection.id);
    } catch (error) {
      const { PlanUpgradeRequired } = await import("@/lib/billing");
      if (error instanceof PlanUpgradeRequired) {
        return Response.json(
          {
            error: "plan_upgrade_required",
            feature: error.feature,
            upgrade_url: "/settings/billing",
          },
          { status: 402 },
        );
      }
      // Non-gate errors are best-effort: log and continue.
      console.warn("[model-gate] pre-flight failed:", error);
    }
  }

  // Start the durable workflow
  const run = await start(runAgentWorkflow, [
    {
      messages,
      chatId,
      sessionId,
      userId,
      tenantId,
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
        customInstructions: assistantFileLinkPrompt,
      },
      ...(shouldAutoCommitPush &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName && {
          autoCommitEnabled: true,
          autoCreatePrEnabled: shouldAutoCreatePr,
          sessionTitle: sessionRecord.title,
          repoOwner: sessionRecord.repoOwner,
          repoName: sessionRecord.repoName,
        }),
    },
  ]);

  // Atomically claim the activeStreamId slot. If another request raced us and
  // already set it, cancel the workflow we just started and reconnect instead.
  const claimed = await compareAndSetChatActiveStreamId(
    chatId,
    null,
    run.runId,
    tenantId,
  );

  if (!claimed) {
    // Another request won the race — cancel our duplicate workflow.
    try {
      const { getRun } = await import("workflow/api");
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cleanup.
    }
    return Response.json(
      { error: "Another workflow is already running for this chat" },
      { status: 409 },
    );
  }

  const stream = createCancelableReadableStream(
    run.getReadable<WebAgentUIMessageChunk>(),
  );

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}

type ExistingActiveStreamResolution =
  | {
      action: "resume";
      runId: string;
      stream: ReadableStream<WebAgentUIMessageChunk>;
    }
  | {
      action: "ready";
    }
  | {
      action: "conflict";
    };

const ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS = 3;

async function reconcileExistingActiveStream(
  chatId: string,
  activeStreamId: string,
  tenantId?: string,
): Promise<ExistingActiveStreamResolution> {
  const { getRun } = await import("workflow/api");
  let currentStreamId: string | null = activeStreamId;

  for (
    let attempt = 1;
    currentStreamId && attempt <= ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      const existingRun = getRun(currentStreamId);
      const status = await existingRun.status;
      if (status === "running" || status === "pending") {
        return {
          action: "resume",
          runId: currentStreamId,
          stream: createCancelableReadableStream(
            existingRun.getReadable<WebAgentUIMessageChunk>(),
          ),
        };
      }
    } catch {
      // Workflow not found or inaccessible — try to clear the stale stream ID.
    }

    const cleared = await compareAndSetChatActiveStreamId(
      chatId,
      currentStreamId,
      null,
      tenantId,
    );
    if (cleared) {
      return { action: "ready" };
    }

    const latestChat = await getChatById(chatId, tenantId);
    currentStreamId = latestChat?.activeStreamId ?? null;
  }

  return currentStreamId ? { action: "conflict" } : { action: "ready" };
}

async function persistLatestUserMessage(
  chatId: string,
  messages: WebAgentUIMessage[],
  tenantId?: string,
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

    await touchChat(chatId, new Date(), tenantId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id, tenantId);
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
        textContent.length > 80
          ? `${textContent.slice(0, 80)}...`
          : textContent;
      await updateChat(chatId, { title }, tenantId);
    }
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }
}
