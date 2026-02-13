import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { BashDisplay } from "./bash-common";

export function BashRenderer({ part, state }: ToolRendererProps<"tool-bash">) {
  const isInputReady = part.state !== "input-streaming";
  const command = isInputReady ? String(part.input?.command ?? "") : "";
  const exitCode =
    part.state === "output-available" ? part.output?.exitCode : undefined;
  const stdout =
    part.state === "output-available" ? String(part.output?.stdout ?? "") : "";
  const stderr =
    part.state === "output-available" ? String(part.output?.stderr ?? "") : "";

  const outputText = [stdout, stderr].filter(Boolean).join("\n").trim();

  return (
    <BashDisplay
      command={command}
      outputText={outputText}
      exitCode={typeof exitCode === "number" ? exitCode : undefined}
      isOutputAvailable={part.state === "output-available"}
      state={state}
    />
  );
}
