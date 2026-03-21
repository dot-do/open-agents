export type SlackRepoKickoff = {
  repoOwner: string;
  repoName: string;
  branch: string | null;
  isNewBranch: boolean;
  prompt: string;
};

export type SlackRepoKickoffParseErrorCode =
  | "missing_repo"
  | "invalid_repo"
  | "empty_branch"
  | "missing_prompt";

export type SlackRepoKickoffParseResult =
  | { ok: true; value: SlackRepoKickoff }
  | {
      ok: false;
      error: {
        code: SlackRepoKickoffParseErrorCode;
        message: string;
      };
    };

const MISSING_REPO_MESSAGE =
  "Use repo=owner/repo#branch <prompt>. Omit #branch to create a new branch.";
const INVALID_REPO_MESSAGE = "Repo must look like owner/repo.";
const EMPTY_BRANCH_MESSAGE =
  "Add a branch after #, or omit #branch to create a new branch.";
const MISSING_PROMPT_MESSAGE =
  "Add a prompt after the repo, for example: repo=vercel/ai Fix the failing tests.";

function stripLeadingMentionTokens(input: string): string {
  let value = input.trim();

  while (true) {
    const next = value.replace(/^(?:<@[^>]+>|@[A-Za-z0-9_.-]+)\s+/u, "");
    if (next === value) {
      return value;
    }
    value = next.trimStart();
  }
}

function splitFirstToken(input: string): { token: string; rest: string } {
  const match = input.match(/^([^\s]+)([\s\S]*)$/u);
  if (!match || !match[1]) {
    return { token: input, rest: "" };
  }

  return {
    token: match[1],
    rest: match[2]?.trim() ?? "",
  };
}

export function parseSlackRepoKickoff(
  input: string,
): SlackRepoKickoffParseResult {
  const normalizedInput = stripLeadingMentionTokens(input);
  if (!normalizedInput.startsWith("repo=")) {
    return {
      ok: false,
      error: {
        code: "missing_repo",
        message: MISSING_REPO_MESSAGE,
      },
    };
  }

  const { token, rest } = splitFirstToken(normalizedInput);
  const repoToken = token.slice("repo=".length);
  const hashIndex = repoToken.indexOf("#");
  const repoPart =
    hashIndex >= 0 ? repoToken.slice(0, hashIndex) : repoToken.trim();
  const branchPart =
    hashIndex >= 0 ? repoToken.slice(hashIndex + 1).trim() : undefined;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repoPart)) {
    return {
      ok: false,
      error: {
        code: "invalid_repo",
        message: INVALID_REPO_MESSAGE,
      },
    };
  }

  if (hashIndex >= 0 && !branchPart) {
    return {
      ok: false,
      error: {
        code: "empty_branch",
        message: EMPTY_BRANCH_MESSAGE,
      },
    };
  }

  if (!rest) {
    return {
      ok: false,
      error: {
        code: "missing_prompt",
        message: MISSING_PROMPT_MESSAGE,
      },
    };
  }

  const [repoOwner, repoName] = repoPart.split("/");
  if (!repoOwner || !repoName) {
    return {
      ok: false,
      error: {
        code: "invalid_repo",
        message: INVALID_REPO_MESSAGE,
      },
    };
  }

  return {
    ok: true,
    value: {
      repoOwner,
      repoName,
      branch: branchPart ?? null,
      isNewBranch: branchPart === undefined,
      prompt: rest,
    },
  };
}

export const slackRepoKickoffErrorMessages = {
  missingRepo: MISSING_REPO_MESSAGE,
  invalidRepo: INVALID_REPO_MESSAGE,
  emptyBranch: EMPTY_BRANCH_MESSAGE,
  missingPrompt: MISSING_PROMPT_MESSAGE,
} as const;
