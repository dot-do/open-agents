"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

export type BashDisplayProps = {
  command: string;
  cwd?: string;
  outputText: string;
  exitCode?: number;
  isOutputAvailable: boolean;
  state: ToolRenderState;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

export function BashDisplay({
  command,
  cwd,
  outputText,
  exitCode,
  isOutputAvailable,
  state,
  onApprove,
  onDeny,
}: BashDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isError = exitCode !== undefined && exitCode !== 0;
  const hasOutput = outputText.length > 0;

  const allLines = outputText.split("\n");
  const outputLines = allLines.slice(-3);
  const hasMoreLines = allLines.length > 3;

  const hasExpandableContent = command.length > 60 || hasMoreLines || cwd;

  const dotColor = state.denied
    ? "bg-red-500"
    : state.approvalRequested
      ? "bg-yellow-500"
      : isError
        ? "bg-red-500"
        : state.running
          ? "bg-yellow-500"
          : "bg-green-500";

  const handleClick = () => {
    if (hasExpandableContent) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hasExpandableContent) {
        setIsExpanded(!isExpanded);
      }
    }
  };

  return (
    <div
      className={cn(
        "my-2 rounded-lg border border-border bg-card p-3",
        hasExpandableContent && "cursor-pointer hover:bg-accent/50",
      )}
      {...(hasExpandableContent && {
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        role: "button",
        tabIndex: 0,
        "aria-expanded": isExpanded,
      })}
    >
      <div className="flex items-center gap-2">
        {state.interrupted ? (
          <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
        ) : state.running ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span
          className={cn(
            "font-medium",
            state.denied ? "text-red-500" : "text-foreground",
          )}
        >
          Bash
        </span>
        <span className="text-muted-foreground">(</span>
        <code className="max-w-md truncate rounded bg-muted px-1 text-sm">
          {command.length > 60
            ? command.slice(0, 60) + "..."
            : command || "..."}
        </code>
        <span className="text-muted-foreground">)</span>
      </div>

      {state.approvalRequested && state.isActiveApproval && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Running...
        </div>
      )}

      {state.approvalRequested &&
        !state.isActiveApproval &&
        state.approvalId && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <ApprovalButtons
              approvalId={state.approvalId}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          </div>
        )}

      {/* Collapsed output preview */}
      {!isExpanded &&
        isOutputAvailable &&
        !state.approvalRequested &&
        !state.denied && (
          <div className="mt-2 pl-5">
            {isError && (
              <div className="text-sm text-red-500">
                Error: Exit code {exitCode}
              </div>
            )}
            {hasOutput ? (
              <div className="mt-1 rounded bg-muted p-2 font-mono text-xs">
                {hasMoreLines && (
                  <div className="text-muted-foreground">...</div>
                )}
                {outputLines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "truncate",
                      isError ? "text-red-400" : "text-foreground",
                    )}
                  >
                    {line.slice(0, 100)}
                  </div>
                ))}
              </div>
            ) : (
              !isError && (
                <div className="text-sm text-muted-foreground">(No output)</div>
              )
            )}
          </div>
        )}

      {/* Expanded full content */}
      {isExpanded && !state.denied && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Full command */}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Command
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
              {command}
            </pre>
          </div>

          {/* Working directory if present */}
          {cwd && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Working Directory
              </div>
              <code className="text-sm text-foreground">{cwd}</code>
            </div>
          )}

          {/* Full output */}
          {isOutputAvailable && (
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>Output</span>
                {exitCode !== undefined && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5",
                      isError
                        ? "bg-red-500/20 text-red-500"
                        : "bg-green-500/20 text-green-500",
                    )}
                  >
                    exit {exitCode}
                  </span>
                )}
              </div>
              {hasOutput ? (
                <pre
                  className={cn(
                    "max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs",
                    isError ? "text-red-400" : "text-foreground",
                  )}
                >
                  {outputText}
                </pre>
              ) : (
                <div className="text-sm text-muted-foreground">(No output)</div>
              )}
            </div>
          )}
        </div>
      )}

      {state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{state.denialReason ? `: ${state.denialReason}` : ""}
        </div>
      )}

      {state.error && !state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {state.error.slice(0, 80)}
        </div>
      )}

      {state.interrupted && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">Interrupted</div>
      )}
    </div>
  );
}
