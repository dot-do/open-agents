import { nanoid } from "nanoid";
import {
  createSessionWithInitialChat,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import {
  getVercelProjectLinkByRepo,
  upsertVercelProjectLink,
} from "@/lib/db/vercel-project-links";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getRandomCityName } from "@/lib/random-city";
import { listMatchingVercelProjects } from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import type { VercelProjectSelection } from "@/lib/vercel/types";

export class CreateSessionForUserError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CreateSessionForUserError";
    this.status = status;
  }
}

export interface CreateSessionForUserInput {
  userId: string;
  username: string;
  name?: string | null;
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch?: boolean;
  sandboxType?: "vercel";
  autoCommitPush?: boolean;
  vercelProject?: VercelProjectSelection | null;
}

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((part) => part[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username.slice(0, 2).toLowerCase();
  }

  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

async function resolveSessionTitle(
  title: string | undefined,
  userId: string,
): Promise<string> {
  if (title && title.trim()) {
    return title.trim();
  }

  const usedNames = await getUsedSessionTitles(userId);
  return getRandomCityName(usedNames);
}

export async function createSessionForUser(input: CreateSessionForUserInput) {
  if (input.sandboxType && input.sandboxType !== "vercel") {
    throw new CreateSessionForUserError("Invalid sandbox type", 400);
  }

  const {
    userId,
    username,
    name,
    repoOwner,
    repoName,
    cloneUrl,
    isNewBranch,
    sandboxType = "vercel",
    autoCommitPush,
    vercelProject,
  } = input;

  let finalBranch = input.branch;
  if (isNewBranch) {
    finalBranch = generateBranchName(username, name);
  }

  const titlePromise = resolveSessionTitle(input.title, userId);
  const preferencesPromise = getUserPreferences(userId);

  let resolvedVercelProject: VercelProjectSelection | null = null;
  const hasRepo = Boolean(repoOwner && repoName);
  if (hasRepo && repoOwner && repoName) {
    if (vercelProject) {
      const vercelToken = await getUserVercelToken(userId);
      if (!vercelToken) {
        throw new CreateSessionForUserError(
          "Connect Vercel to select a Vercel project",
          403,
        );
      }

      const matchingProjects = await listMatchingVercelProjects({
        token: vercelToken,
        repoOwner,
        repoName,
      });
      const matchedProject =
        matchingProjects.find(
          (project) => project.projectId === vercelProject.projectId,
        ) ?? null;
      if (!matchedProject) {
        throw new CreateSessionForUserError(
          "Selected Vercel project no longer matches this repository",
          400,
        );
      }

      await upsertVercelProjectLink({
        userId,
        repoOwner,
        repoName,
        project: matchedProject,
      });
      resolvedVercelProject = matchedProject;
    } else if (vercelProject === undefined) {
      resolvedVercelProject = await getVercelProjectLinkByRepo(
        userId,
        repoOwner,
        repoName,
      );
    }
  }

  const [title, preferences] = await Promise.all([
    titlePromise,
    preferencesPromise,
  ]);

  return createSessionWithInitialChat({
    session: {
      id: nanoid(),
      userId,
      title,
      status: "running",
      repoOwner,
      repoName,
      branch: finalBranch,
      cloneUrl,
      vercelProjectId: resolvedVercelProject?.projectId ?? null,
      vercelProjectName: resolvedVercelProject?.projectName ?? null,
      vercelTeamId: resolvedVercelProject?.teamId ?? null,
      vercelTeamSlug: resolvedVercelProject?.teamSlug ?? null,
      isNewBranch: isNewBranch ?? false,
      autoCommitPushOverride: autoCommitPush ?? preferences.autoCommitPush,
      sandboxState: { type: sandboxType },
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
    },
    initialChat: {
      id: nanoid(),
      title: "New chat",
      modelId: preferences.defaultModelId,
    },
  });
}
