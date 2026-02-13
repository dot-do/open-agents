"use client";

import type { ToolRendererProps } from "@/app/lib/render-tool";
import { BashDisplay } from "./bash-common";

export function BashRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-bash">) {
  const input = part.input;
  const command = String(input?.command ?? "");
  const cwd = input?.cwd;

  const output = part.state === "output-available" ? part.output : undefined;
  const exitCode = output?.exitCode;
  const stdout = String(output?.stdout ?? "");
  const stderr = String(output?.stderr ?? "");

  const outputText = [stdout, stderr].filter(Boolean).join("\n").trim();

  return (
    <BashDisplay
      command={command}
      cwd={cwd}
      outputText={outputText}
      exitCode={typeof exitCode === "number" ? exitCode : undefined}
      isOutputAvailable={part.state === "output-available"}
      state={state}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
