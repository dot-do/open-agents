"use client";

import type { TaskToolUIPart } from "@open-harness/agent";
import { isReasoningUIPart, isToolUIPart } from "ai";
import { Check, Copy, Loader2, RotateCcw, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback } from "react";
import type {
  WebAgentUIMessage,
  WebAgentUIMessagePart,
  WebAgentUIToolPart,
} from "@/app/types";
import { AssistantMessageGroups } from "@/components/assistant-message-groups";
import { TaskGroupView } from "@/components/task-group-view";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call";
import {
  hasRenderableAssistantPart,
  shouldKeepCollapsedReasoningStreaming,
} from "@/lib/chat-streaming-state";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";
import "streamdown/styles.css";

const Streamdown = dynamic(
  () => import("streamdown").then((m) => m.Streamdown),
  { ssr: false },
);

type ReasoningMessagePart = Extract<
  WebAgentUIMessagePart,
  { type: "reasoning" }
>;

type MessageRenderGroup =
  | {
      type: "part";
      part: WebAgentUIMessagePart;
      index: number;
      renderKey: string;
    }
  | {
      type: "task-group";
      tasks: TaskToolUIPart[];
      startIndex: number;
      renderKey: string;
    }
  | {
      type: "reasoning-group";
      parts: ReasoningMessagePart[];
      startIndex: number;
      renderKey: string;
    };

type ChatMessageRowProps = {
  message: WebAgentUIMessage;
  groups: MessageRenderGroup[];
  isExpanded: boolean;
  isStreaming: boolean;
  durationMs: number | null;
  startedAt: string | null;
  copiedAssistantMessageId: string | null;
  deletingMessageId: string | null;
  resendingMessageId: string | null;
  hasMessageActionInFlight: boolean;
  onExpandedChange: (messageId: string, isExpanded: boolean) => void;
  onCopyAssistantMessage: (
    messageId: string,
    text: string,
  ) => void | Promise<void>;
  onDeleteUserMessage: (messageId: string) => void | Promise<void>;
  onResendUserMessage: (messageId: string) => void | Promise<void>;
  onApproveTool: (id: string) => void;
  onDenyTool: (id: string, reason?: string) => void;
};

function getReasoningGroupText(parts: ReasoningMessagePart[]): string {
  return parts
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

function isSameMessageScopedId(
  messageId: string,
  previousId: string | null,
  nextId: string | null,
): boolean {
  if (previousId === nextId) {
    return true;
  }

  return previousId !== messageId && nextId !== messageId;
}

export const ChatMessageRow = memo(
  function ChatMessageRow({
    message,
    groups,
    isExpanded,
    isStreaming,
    durationMs,
    startedAt,
    copiedAssistantMessageId,
    deletingMessageId,
    resendingMessageId,
    hasMessageActionInFlight,
    onExpandedChange,
    onCopyAssistantMessage,
    onDeleteUserMessage,
    onResendUserMessage,
    onApproveTool,
    onDenyTool,
  }: ChatMessageRowProps) {
    const handleExpandedChange = useCallback(
      (nextIsExpanded: boolean) => {
        onExpandedChange(message.id, nextIsExpanded);
      },
      [message.id, onExpandedChange],
    );

    const renderGroups = useCallback(
      (isToolCallsExpanded: boolean) =>
        groups.map((group) => {
          if (group.type === "task-group") {
            if (!isToolCallsExpanded) return null;
            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className="max-w-full"
              >
                <TaskGroupView
                  taskParts={group.tasks}
                  activeApprovalId={
                    group.tasks.find(
                      (task) => task.state === "approval-requested",
                    )?.approval?.id ?? null
                  }
                  isStreaming={isStreaming}
                  onApprove={onApproveTool}
                  onDeny={onDenyTool}
                />
              </div>
            );
          }

          if (group.type === "reasoning-group") {
            if (!isToolCallsExpanded) return null;
            const hasRenderableContentAfterGroup = message.parts
              .slice(group.startIndex + group.parts.length)
              .some(hasRenderableAssistantPart);

            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className="flex justify-start"
              >
                <ThinkingBlock
                  text={getReasoningGroupText(group.parts)}
                  isStreaming={shouldKeepCollapsedReasoningStreaming({
                    isMessageStreaming: isStreaming,
                    hasStreamingReasoningPart: group.parts.some(
                      (part) => part.state === "streaming",
                    ),
                    hasRenderableContentAfterGroup,
                  })}
                  partCount={group.parts.length}
                />
              </div>
            );
          }

          const part = group.part;

          if (isReasoningUIPart(part)) {
            if (!isToolCallsExpanded) return null;
            const hasRenderableContentAfterGroup = message.parts
              .slice(group.index + 1)
              .some(hasRenderableAssistantPart);

            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className="flex justify-start"
              >
                <ThinkingBlock
                  text={part.text}
                  isStreaming={shouldKeepCollapsedReasoningStreaming({
                    isMessageStreaming: isStreaming,
                    hasStreamingReasoningPart: part.state === "streaming",
                    hasRenderableContentAfterGroup,
                  })}
                />
              </div>
            );
          }

          if (part.type === "text") {
            if (part.text.length === 0) {
              return null;
            }

            const isFinalAssistantTextPart =
              message.role === "assistant" &&
              !message.parts
                .slice(group.index + 1)
                .some((messagePart) => messagePart.type === "text");

            if (
              !isToolCallsExpanded &&
              message.role === "assistant" &&
              !isFinalAssistantTextPart
            ) {
              return null;
            }

            const canCopyAssistantMessage =
              isFinalAssistantTextPart &&
              !isStreaming &&
              part.text.trim().length > 0;

            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className={cn(
                  "flex min-w-0",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {message.role === "user" ? (
                  <div className="group relative w-fit min-w-0 max-w-[80%]">
                    <div className="rounded-3xl bg-secondary px-4 py-2">
                      <p className="whitespace-pre-wrap break-words">
                        {part.text}
                      </p>
                    </div>
                    {group.index === 0 && (
                      <div className="absolute -left-20 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void onResendUserMessage(message.id)}
                          disabled={hasMessageActionInFlight}
                          aria-label="Resend this message and delete everything after it"
                          className="rounded p-1 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {resendingMessageId === message.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteUserMessage(message.id)}
                          disabled={hasMessageActionInFlight}
                          aria-label="Delete this message and everything after it"
                          className="rounded p-1 transition hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {deletingMessageId === message.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="group min-w-0 w-full overflow-hidden">
                    <Streamdown
                      animated={
                        isStreaming
                          ? {
                              animation: "fadeIn",
                              duration: 250,
                              easing: "ease-out",
                            }
                          : undefined
                      }
                      mode={isStreaming ? "streaming" : "static"}
                      isAnimating={isStreaming}
                      plugins={streamdownPlugins}
                    >
                      {part.text}
                    </Streamdown>
                    {canCopyAssistantMessage && (
                      <div className="mt-1 flex justify-start">
                        <button
                          type="button"
                          onClick={() =>
                            void onCopyAssistantMessage(message.id, part.text)
                          }
                          aria-label="Copy assistant response"
                          className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          {copiedAssistantMessageId === message.id ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }

          if (isToolUIPart(part)) {
            if (!isToolCallsExpanded) return null;
            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className="max-w-full"
              >
                <ToolCall
                  part={part as WebAgentUIToolPart}
                  isStreaming={isStreaming}
                  onApprove={onApproveTool}
                  onDeny={onDenyTool}
                />
              </div>
            );
          }

          if (part.type === "file" && part.mediaType?.startsWith("image/")) {
            if (!isToolCallsExpanded && message.role === "assistant") {
              return null;
            }
            return (
              <div
                key={`${message.id}-${group.renderKey}`}
                className="flex justify-end"
              >
                <div className="group relative w-fit max-w-[80%]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
                  <img
                    src={part.url}
                    alt={part.filename ?? "Attached image"}
                    className="max-h-64 rounded-lg"
                  />
                  {message.role === "user" && group.index === 0 && (
                    <button
                      type="button"
                      onClick={() => void onDeleteUserMessage(message.id)}
                      disabled={hasMessageActionInFlight}
                      aria-label="Delete this message and everything after it"
                      className="absolute -left-10 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingMessageId === message.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          }

          return null;
        }),
      [
        copiedAssistantMessageId,
        deletingMessageId,
        groups,
        hasMessageActionInFlight,
        isStreaming,
        message,
        onApproveTool,
        onCopyAssistantMessage,
        onDeleteUserMessage,
        onDenyTool,
        onResendUserMessage,
        resendingMessageId,
      ],
    );

    if (message.role !== "assistant") {
      return <>{renderGroups(true)}</>;
    }

    return (
      <AssistantMessageGroups
        message={message}
        isExpanded={isExpanded}
        onExpandedChange={handleExpandedChange}
        isStreaming={isStreaming}
        durationMs={durationMs}
        startedAt={startedAt}
        renderExpandedContent={() => renderGroups(true)}
        renderCollapsedContent={() => renderGroups(false)}
      />
    );
  },
  (previousProps, nextProps) => {
    if (previousProps.message !== nextProps.message) {
      return false;
    }

    if (previousProps.groups !== nextProps.groups) {
      return false;
    }

    if (previousProps.isExpanded !== nextProps.isExpanded) {
      return false;
    }

    if (previousProps.isStreaming !== nextProps.isStreaming) {
      return false;
    }

    if (previousProps.durationMs !== nextProps.durationMs) {
      return false;
    }

    if (previousProps.startedAt !== nextProps.startedAt) {
      return false;
    }

    if (
      !isSameMessageScopedId(
        previousProps.message.id,
        previousProps.copiedAssistantMessageId,
        nextProps.copiedAssistantMessageId,
      )
    ) {
      return false;
    }

    if (
      !isSameMessageScopedId(
        previousProps.message.id,
        previousProps.deletingMessageId,
        nextProps.deletingMessageId,
      )
    ) {
      return false;
    }

    if (
      !isSameMessageScopedId(
        previousProps.message.id,
        previousProps.resendingMessageId,
        nextProps.resendingMessageId,
      )
    ) {
      return false;
    }

    if (
      previousProps.message.role === "user" &&
      previousProps.hasMessageActionInFlight !==
        nextProps.hasMessageActionInFlight
    ) {
      return false;
    }

    return true;
  },
);
