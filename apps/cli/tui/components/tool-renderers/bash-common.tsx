import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRenderState } from "../../lib/render-tool";
import { truncateText } from "../../lib/truncate";

import { getDotColor, ToolSpinner } from "./shared";

export type BashDisplayProps = {
  command: string;
  outputText: string;
  exitCode?: number;
  isOutputAvailable: boolean;
  state: ToolRenderState;
};

export function BashDisplay({
  command,
  outputText,
  exitCode,
  isOutputAvailable,
  state,
}: BashDisplayProps) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const hasOutput = outputText.length > 0;

  const allLines = outputText.split("\n");
  const outputLines = allLines.slice(-3);
  const hasMoreLines = allLines.length > 3;
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const prefixLength = 2 + "Bash(".length;
  const suffixLength = 1;
  const safetyPadding = 2;
  const maxCommandWidth = Math.max(
    1,
    terminalWidth - prefixLength - suffixLength - safetyPadding,
  );
  const displayCommand = truncateText(command || "...", maxCommandWidth);
  const outputMaxWidth = Math.max(10, terminalWidth - 6);
  const errorPrefix = "Error: ";
  const maxErrorWidth = Math.max(10, terminalWidth - 2 - errorPrefix.length);

  const dotColor = state.denied
    ? "red"
    : state.approvalRequested
      ? PRIMARY_COLOR
      : isError
        ? "red"
        : getDotColor(state);

  const indicator = state.running ? (
    <ToolSpinner />
  ) : state.interrupted ? (
    <text fg={PRIMARY_COLOR}>○ </text>
  ) : (
    <text fg={dotColor}>● </text>
  );

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <box flexDirection="row">
        {indicator}
        <text
          fg={state.denied ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          Bash
        </text>
        <text fg="gray">(</text>
        <text fg="white">{displayCommand}</text>
        <text fg="gray">)</text>
      </box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </text>
        </box>
      )}

      {/* Show output when completed */}
      {isOutputAvailable &&
        !state.approvalRequested &&
        !state.denied &&
        !state.interrupted && (
          <box flexDirection="column" paddingLeft={2}>
            {isError && (
              <box flexDirection="row">
                <text fg="gray">└ </text>
                <text fg="red">Error: Exit code {exitCode}</text>
              </box>
            )}
            {hasOutput ? (
              <box flexDirection="column">
                {hasMoreLines && (
                  <box paddingLeft={isError ? 2 : 0} flexDirection="row">
                    <text fg="gray">└ </text>
                    <text fg="gray">...</text>
                  </box>
                )}
                {outputLines.map((line, i) => (
                  <box
                    key={i}
                    paddingLeft={isError ? 2 : 0}
                    flexDirection="row"
                  >
                    {!hasMoreLines && !isError && i === 0 && (
                      <text fg="gray">└ </text>
                    )}
                    {(hasMoreLines || isError || i > 0) && <text> </text>}
                    <text fg={isError ? "red" : "white"}>
                      {truncateText(line, outputMaxWidth)}
                    </text>
                  </box>
                ))}
              </box>
            ) : (
              !isError && (
                <box flexDirection="row">
                  <text fg="gray">└ </text>
                  <text fg="gray">(No content)</text>
                </box>
              )
            )}
          </box>
        )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            {errorPrefix}
            {truncateText(state.error, maxErrorWidth)}
          </text>
        </box>
      )}

      {state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg={PRIMARY_COLOR}>Interrupted</text>
        </box>
      )}
    </box>
  );
}
