import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import {
  CreateSessionForUserError,
  createSessionForUser,
} from "@/lib/sessions/create-session-for-user";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  vercelProjectSelectionSchema,
  type VercelProjectSelection,
} from "@/lib/vercel/types";

interface CreateSessionRequest {
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

const DEFAULT_ARCHIVED_SESSIONS_LIMIT = 50;
const MAX_ARCHIVED_SESSIONS_LIMIT = 100;

type SessionsStatusFilter = "all" | "active" | "archived";

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  return Number(value);
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get("status");
  if (
    rawStatus !== null &&
    rawStatus !== "all" &&
    rawStatus !== "active" &&
    rawStatus !== "archived"
  ) {
    return Response.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const statusParam: SessionsStatusFilter = rawStatus ?? "all";

  if (statusParam === "archived") {
    const rawLimit = parseNonNegativeInteger(searchParams.get("limit"));
    const rawOffset = parseNonNegativeInteger(searchParams.get("offset"));

    if (searchParams.get("limit") !== null && rawLimit === null) {
      return Response.json(
        { error: "Invalid archived limit" },
        { status: 400 },
      );
    }

    if (searchParams.get("offset") !== null && rawOffset === null) {
      return Response.json(
        { error: "Invalid archived offset" },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(rawLimit ?? DEFAULT_ARCHIVED_SESSIONS_LIMIT, 1),
      MAX_ARCHIVED_SESSIONS_LIMIT,
    );
    const offset = rawOffset ?? 0;

    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "archived",
        limit,
        offset,
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({
      sessions,
      archivedCount,
      pagination: {
        limit,
        offset,
        hasMore: offset + sessions.length < archivedCount,
        nextOffset: offset + sessions.length,
      },
    });
  }

  if (statusParam === "active") {
    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "active",
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({ sessions, archivedCount });
  }

  const sessions = await getSessionsWithUnreadByUserId(session.user.id);
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateSessionRequest;
  try {
    body = (await req.json()) as CreateSessionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }

  let explicitVercelProject: VercelProjectSelection | null | undefined;
  if (body.vercelProject === null) {
    explicitVercelProject = null;
  } else if (body.vercelProject !== undefined) {
    const parsedProject = vercelProjectSelectionSchema.safeParse(
      body.vercelProject,
    );
    if (!parsedProject.success) {
      return Response.json(
        { error: "Invalid Vercel project" },
        { status: 400 },
      );
    }
    explicitVercelProject = parsedProject.data;
  }

  try {
    const result = await createSessionForUser({
      userId: session.user.id,
      username: session.user.username,
      name: session.user.name,
      title: body.title,
      repoOwner: body.repoOwner,
      repoName: body.repoName,
      branch: body.branch,
      cloneUrl: body.cloneUrl,
      isNewBranch: body.isNewBranch,
      sandboxType: body.sandboxType ?? "vercel",
      autoCommitPush: body.autoCommitPush,
      vercelProject: explicitVercelProject,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof CreateSessionForUserError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to create session:", error);
    return Response.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
