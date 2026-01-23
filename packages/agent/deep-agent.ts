import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type TypedToolResult,
  gateway,
} from "ai";
import { z } from "zod";
import {
  todoWriteTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  grepTool,
  globTool,
  bashTool,
  taskTool,
  askUserQuestionTool,
  enterPlanModeTool,
  exitPlanModeTool,
  extractEnterPlanModeOutput,
  extractExitPlanModeOutput,
} from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import type { TodoItem, ApprovalConfig, AgentMode } from "./types";
import { approvalRuleSchema } from "./types";
import { addCacheControl, compactContext } from "./context-management";
import type { Sandbox } from "@open-harness/sandbox";

const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

const agentModeSchema = z.enum(["default", "plan"]).default("default");

const callOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  agentMode: agentModeSchema.optional(),
  planFilePath: z.string().optional(),
});

export type DeepAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModel = gateway("anthropic/claude-haiku-4.5");
export const defaultModelLabel = defaultModel.modelId;

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  enter_plan_mode: enterPlanModeTool(),
  exit_plan_mode: exitPlanModeTool(),
} satisfies ToolSet;

// Tool sets by mode - defines which tools are available in each mode
const DEFAULT_MODE_TOOLS = [
  "todo_write",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
  "task",
  "ask_user_question",
  "enter_plan_mode",
] as const;

const PLAN_MODE_TOOLS = [
  "read",
  "grep",
  "glob",
  "bash",
  "task",
  "ask_user_question",
  "write",
  "edit",
  "exit_plan_mode",
] as const;

export const deepAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(50),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps, experimental_context }) => {
    const context = experimental_context as {
      sandbox: Sandbox;
      approval: ApprovalConfig;
      agentMode: AgentMode;
      planFilePath: string | undefined;
      customInstructions: string | undefined;
    };

    let agentMode = context.agentMode;
    let planFilePath = context.planFilePath;
    let modeChanged = false;

    // Check for mode changes in both steps (current request) and messages (approval responses)
    // Steps contain tool results from this request's execution
    // Messages contain tool results from approval responses (including denials)

    // First, check for denied tools in messages (these override any successful execution)
    const deniedTools = new Set<string>();
    for (const message of messages) {
      if (message.role === "tool" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (
            part.type === "tool-result" &&
            typeof part.output === "object" &&
            part.output !== null &&
            "type" in part.output &&
            part.output.type === "execution-denied"
          ) {
            deniedTools.add(part.toolCallId);
          }
        }
      }
    }

    // Check the last step for mode changes (skip if tool was denied)
    const lastStep = steps[steps.length - 1];
    if (lastStep?.toolResults) {
      for (const result of lastStep.toolResults) {
        // Skip tools that were denied
        if (deniedTools.has(result.toolCallId)) {
          continue;
        }
        if (result.toolName === "enter_plan_mode") {
          const output = extractEnterPlanModeOutput(result.output);
          if (output) {
            agentMode = "plan";
            planFilePath = output.planFilePath;
            modeChanged = true;
          }
        } else if (result.toolName === "exit_plan_mode") {
          const output = extractExitPlanModeOutput(result.output);
          if (output) {
            agentMode = "default";
            planFilePath = undefined;
            modeChanged = true;
          }
        }
      }
    }

    // Check if we should force exit_plan_mode after plan file creation
    let forceExitPlanMode = false;
    if (agentMode === "plan" && planFilePath) {
      const lastStepForPlanCheck = steps[steps.length - 1];
      if (
        lastStepForPlanCheck?.toolCalls &&
        lastStepForPlanCheck?.toolResults
      ) {
        for (const result of lastStepForPlanCheck.toolResults) {
          if (deniedTools.has(result.toolCallId)) continue;
          if (
            !result.dynamic &&
            result.toolName === "write" &&
            result.output?.success === true
          ) {
            // Find matching tool call with proper type narrowing
            for (const tc of lastStepForPlanCheck.toolCalls) {
              if (
                !tc.dynamic &&
                tc.toolName === "write" &&
                tc.toolCallId === result.toolCallId &&
                tc.input.filePath === planFilePath
              ) {
                forceExitPlanMode = true;
                break;
              }
            }
            if (forceExitPlanMode) break;
          }
        }
      }
    }

    // Update active tools based on current mode
    const activeToolNames =
      agentMode === "plan" ? PLAN_MODE_TOOLS : DEFAULT_MODE_TOOLS;

    // Rebuild instructions if mode changed
    let instructions: string | undefined;
    if (modeChanged) {
      const mode =
        context.approval.type === "background" ? "background" : "interactive";
      instructions = buildSystemPrompt({
        cwd: context.sandbox.workingDirectory,
        mode,
        currentBranch: context.sandbox.currentBranch,
        customInstructions: context.customInstructions,
        environmentDetails: context.sandbox.environmentDetails,
        agentMode,
        planFilePath,
      });
    }

    return {
      messages: addCacheControl({
        messages: compactContext({ messages, steps }),
        model,
      }),
      // activeTools: [...activeToolNames],
      ...(forceExitPlanMode && {
        toolChoice: { type: "tool", toolName: "exit_plan_mode" },
      }),
      ...(instructions && { instructions }),
      experimental_context: {
        ...(experimental_context as object),
        agentMode,
        planFilePath,
      },
    };
  },
  prepareCall: ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error(
        "Deep agent requires call options with sandbox and approval config.",
      );
    }
    const approval: ApprovalConfig = options.approval;
    const callModel = options.model ?? model;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const agentMode: AgentMode = options.agentMode ?? "default";
    const planFilePath = options.planFilePath;

    // Derive mode for system prompt (interactive vs background)
    const mode = approval.type === "background" ? "background" : "interactive";

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      mode,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      agentMode,
      planFilePath,
    });

    // Select which tools are active based on agent mode
    const activeToolNames =
      agentMode === "plan" ? PLAN_MODE_TOOLS : DEFAULT_MODE_TOOLS;

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      // activeTools: [...activeToolNames],
      instructions,
      experimental_context: {
        sandbox,
        approval,
        agentMode,
        planFilePath,
        customInstructions,
      },
    };
  },
});

export function extractTodosFromStep(
  toolResults: Array<TypedToolResult<typeof deepAgent.tools>>,
): TodoItem[] | null {
  for (const result of toolResults) {
    if (!result.dynamic && result.toolName === "todo_write" && result.output) {
      return result.output.todos;
    }
  }
  return null;
}

export type DeepAgent = typeof deepAgent;
