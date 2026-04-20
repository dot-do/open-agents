import { discoverSkills } from "@open-harness/agent";
import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearUnavailableSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

export type SkillSuggestion = {
  name: string;
  description: string;
};

export type SkillsResponse = {
  skills: SkillSuggestion[];
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function toSkillSuggestions(
  skills: Awaited<ReturnType<typeof discoverSkills>>,
): SkillSuggestion[] {
  return skills
    .filter((skill) => skill.options.userInvocable !== false)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    tenantId: authResult.tenantId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  // Tenant-scope the cache key so two tenants cannot read/poison each other's
  // skill list via a colliding sessionId. Sessions without a tenantId are
  // legacy single-tenant rows; use a sentinel namespace so they don't collide
  // with any real tenantId either.
  const cacheTenantId = sessionRecord.tenantId ?? "_legacy";

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  if (!refresh) {
    const cachedSkills = await getCachedSkills(
      cacheTenantId,
      sessionId,
      sandboxState,
    );
    if (cachedSkills !== null) {
      return Response.json({ skills: toSkillSuggestions(cachedSkills) });
    }
  }

  if (!hasRuntimeSandboxState(sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const skillDirs = await getSandboxSkillDirectories(sandbox);

    const skills = await discoverSkills(sandbox, skillDirs);
    await setCachedSkills(cacheTenantId, sessionId, sandboxState, skills);

    const response: SkillsResponse = { skills: toSkillSuggestions(skills) };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearUnavailableSandboxState(
          sessionRecord.sandboxState,
          message,
        ),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }
    console.error("Failed to discover skills:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
