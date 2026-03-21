import { describe, expect, test } from "bun:test";
import {
  parseSlackRepoKickoff,
  slackRepoKickoffErrorMessages,
} from "./repo-parser";

describe("parseSlackRepoKickoff", () => {
  test("parses repo token with explicit branch", () => {
    const result = parseSlackRepoKickoff(
      "repo=vercel/ai#main Fix the failing tests",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        repoOwner: "vercel",
        repoName: "ai",
        branch: "main",
        isNewBranch: false,
        prompt: "Fix the failing tests",
      },
    });
  });

  test("treats missing branch as new-branch mode", () => {
    const result = parseSlackRepoKickoff("repo=vercel/ai Add Slack support");

    expect(result).toEqual({
      ok: true,
      value: {
        repoOwner: "vercel",
        repoName: "ai",
        branch: null,
        isNewBranch: true,
        prompt: "Add Slack support",
      },
    });
  });

  test("strips a leading mention token", () => {
    const result = parseSlackRepoKickoff(
      "@openharness repo=vercel/ai#feat/slack Add Slack support",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        repoOwner: "vercel",
        repoName: "ai",
        branch: "feat/slack",
        isNewBranch: false,
        prompt: "Add Slack support",
      },
    });
  });

  test("returns an error when the repo token is missing", () => {
    const result = parseSlackRepoKickoff("Fix the failing tests");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_repo",
        message: slackRepoKickoffErrorMessages.missingRepo,
      },
    });
  });

  test("returns an error for malformed repos", () => {
    const result = parseSlackRepoKickoff("repo=vercel Fix the failing tests");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_repo",
        message: slackRepoKickoffErrorMessages.invalidRepo,
      },
    });
  });

  test("returns an error for empty branches", () => {
    const result = parseSlackRepoKickoff(
      "repo=vercel/ai# Fix the failing tests",
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "empty_branch",
        message: slackRepoKickoffErrorMessages.emptyBranch,
      },
    });
  });

  test("returns an error when the prompt is missing", () => {
    const result = parseSlackRepoKickoff("repo=vercel/ai#main");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_prompt",
        message: slackRepoKickoffErrorMessages.missingPrompt,
      },
    });
  });
});
