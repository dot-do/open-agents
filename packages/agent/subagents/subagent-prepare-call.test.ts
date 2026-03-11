import { describe, expect, test } from "bun:test";
import { gateway, type ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { executorSubagent } from "./executor";
import { explorerSubagent } from "./explorer";

function createMockModel() {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock-model",
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 1,
          text: 1,
          reasoning: 0,
        },
      },
      warnings: [],
    },
  });
}

function getPrepareCall(agent: unknown) {
  if (!agent || (typeof agent !== "object" && typeof agent !== "function")) {
    throw new Error("Subagent instance is unavailable");
  }

  const settings = Reflect.get(agent, "settings");
  if (!settings || typeof settings !== "object") {
    throw new Error("Subagent settings are unavailable");
  }

  const prepareCall = Reflect.get(settings, "prepareCall");
  if (typeof prepareCall !== "function") {
    throw new Error("Subagent prepareCall is unavailable");
  }

  return prepareCall;
}

describe("subagent prepareCall", () => {
  test("executor embeds task details and delegated runtime context", async () => {
    const prepareCall = getPrepareCall(executorSubagent);
    const model = createMockModel();

    const preparedCall = await prepareCall({
      options: {
        task: "Apply implementation",
        instructions: "Update files and run checks.",
        sandboxConfig: {
          kind: "local",
          workingDirectory: "/tmp/workspace",
        },
        model,
      },
      model,
      prompt: "Complete this task and provide a summary.",
    });

    expect(preparedCall.model).toBe(model);

    expect(typeof preparedCall.instructions).toBe("string");
    if (typeof preparedCall.instructions !== "string") {
      throw new Error("Expected subagent instructions to be a string");
    }

    expect(preparedCall.instructions).toContain(
      "## Your Task\nApply implementation",
    );
    expect(preparedCall.instructions).toContain(
      "## Detailed Instructions\nUpdate files and run checks.",
    );

    const experimentalContext = preparedCall.experimental_context;
    expect(experimentalContext).toBeDefined();
    if (!experimentalContext || typeof experimentalContext !== "object") {
      throw new Error("Expected experimental_context from prepareCall");
    }

    expect(Reflect.get(experimentalContext, "workingDirectory")).toBe(
      "/tmp/workspace",
    );
    expect(Reflect.get(experimentalContext, "approval")).toEqual({
      type: "delegated",
    });
  });

  test("explorer derives Vercel working directory and preserves read-only guidance", async () => {
    const prepareCall = getPrepareCall(explorerSubagent);
    const model = createMockModel();

    const preparedCall = await prepareCall({
      options: {
        task: "Explore codebase",
        instructions: "Find where prepareCall is implemented.",
        sandboxConfig: {
          kind: "state",
          state: {
            type: "vercel",
          },
        },
        model,
      },
      model,
      prompt: "Complete this task and provide a summary.",
    });

    expect(typeof preparedCall.instructions).toBe("string");
    if (typeof preparedCall.instructions !== "string") {
      throw new Error("Expected subagent instructions to be a string");
    }

    expect(preparedCall.instructions).toContain(
      "This is READ-ONLY - do NOT create, modify, or delete any files",
    );
    expect(preparedCall.instructions).toContain(
      "## Your Task\nExplore codebase",
    );

    const experimentalContext = preparedCall.experimental_context;
    expect(experimentalContext).toBeDefined();
    if (!experimentalContext || typeof experimentalContext !== "object") {
      throw new Error("Expected experimental_context from prepareCall");
    }

    expect(Reflect.get(experimentalContext, "workingDirectory")).toBe(
      "/vercel/sandbox",
    );
    expect(Reflect.get(experimentalContext, "approval")).toEqual({
      type: "delegated",
    });
  });

  test("executor sanitizes GPT-5.4 reasoning prompt arrays", async () => {
    const prepareCall = getPrepareCall(executorSubagent);
    const model = gateway("openai/gpt-5.4-codex");

    const prompt = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
    ] satisfies ModelMessage[];

    const preparedCall = await prepareCall({
      options: {
        task: "Apply implementation",
        instructions: "Update files and run checks.",
        sandboxConfig: {
          kind: "local",
          workingDirectory: "/tmp/workspace",
        },
        model,
      },
      model,
      prompt,
    });

    expect(preparedCall.prompt).toEqual([
      {
        role: "user",
        content: "Plan the fix.",
      },
    ]);
  });

  test("explorer sanitizes GPT-5.4 reasoning prompt arrays", async () => {
    const prepareCall = getPrepareCall(explorerSubagent);
    const model = gateway("openai/gpt-5.4-codex");

    const prompt = [
      { role: "user", content: "Plan the fix." },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Inspecting the failure",
            providerOptions: {
              openai: {
                itemId: "rs_123",
              },
            },
          },
        ],
      },
    ] satisfies ModelMessage[];

    const preparedCall = await prepareCall({
      options: {
        task: "Explore codebase",
        instructions: "Find where prepareCall is implemented.",
        sandboxConfig: {
          kind: "local",
          workingDirectory: "/tmp/workspace",
        },
        model,
      },
      model,
      prompt,
    });

    expect(preparedCall.prompt).toEqual([
      {
        role: "user",
        content: "Plan the fix.",
      },
    ]);
  });
});
