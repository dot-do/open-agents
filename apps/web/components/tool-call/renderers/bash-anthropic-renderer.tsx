"use client";

import type { ToolRendererProps } from "@/app/lib/render-tool";
import { BashDisplay } from "./bash-common";

/**
 * Extract text content from Anthropic bash tool output.
 * The output is an array of content blocks: [{ type: "text", text: "..." }].
 */
function extractOutputText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function BashAnthropicRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-bash_anthropic">) {
  const command = String(part.input?.command ?? "");
  const outputText =
    part.state === "output-available" ? extractOutputText(part.output) : "";

  return (
    <BashDisplay
      command={command}
      outputText={outputText}
      isOutputAvailable={part.state === "output-available"}
      state={state}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
