import * as sessionsDb from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

export type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof sessionsDb.getSessionById>>
>;
export type ChatRecord = NonNullable<
  Awaited<ReturnType<typeof sessionsDb.getChatById>>
>;

type AuthenticatedUserResult =
  | {
      ok: true;
      userId: string;
      tenantId: string | undefined;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
      chat: ChatRecord;
    }
  | {
      ok: false;
      response: Response;
    };

interface RequireOwnedSessionParams {
  userId: string;
  sessionId: string;
  tenantId?: string;
  forbiddenMessage?: string;
}

interface RequireOwnedSessionChatParams {
  userId: string;
  sessionId: string;
  chatId: string;
  tenantId?: string;
  forbiddenMessage?: string;
}

interface RequireOwnedSessionWithSandboxGuardParams extends RequireOwnedSessionParams {
  sandboxGuard: (sandboxState: SessionRecord["sandboxState"]) => boolean;
  sandboxErrorMessage?: string;
  sandboxErrorStatus?: number;
}

function toErrorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUserResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return {
      ok: false,
      response: toErrorResponse("Not authenticated", 401),
    };
  }

  return {
    ok: true,
    userId: session.user.id,
    tenantId: session.activeTenantId ?? undefined,
  };
}

export async function requireOwnedSession(
  params: RequireOwnedSessionParams,
): Promise<OwnedSessionResult> {
  const { userId, sessionId, tenantId, forbiddenMessage = "Forbidden" } = params;

  const sessionRecord = await sessionsDb.getSessionById(sessionId, tenantId);
  if (!sessionRecord) {
    return {
      ok: false,
      response: toErrorResponse("Session not found", 404),
    };
  }

  if (sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403),
    };
  }

  // Tenant mismatch check (defense-in-depth — the query already filters)
  if (tenantId && sessionRecord.tenantId && sessionRecord.tenantId !== tenantId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403),
    };
  }

  return {
    ok: true,
    sessionRecord,
  };
}

export async function requireOwnedSessionWithSandboxGuard(
  params: RequireOwnedSessionWithSandboxGuardParams,
): Promise<OwnedSessionResult> {
  const {
    userId,
    sessionId,
    forbiddenMessage,
    sandboxGuard,
    sandboxErrorMessage = "Sandbox not initialized",
    sandboxErrorStatus = 400,
  } = params;

  const ownedSessionResult = await requireOwnedSession({
    userId,
    sessionId,
    forbiddenMessage,
  });
  if (!ownedSessionResult.ok) {
    return ownedSessionResult;
  }

  if (!sandboxGuard(ownedSessionResult.sessionRecord.sandboxState)) {
    return {
      ok: false,
      response: toErrorResponse(sandboxErrorMessage, sandboxErrorStatus),
    };
  }

  return ownedSessionResult;
}

export async function requireOwnedSessionChat(
  params: RequireOwnedSessionChatParams,
): Promise<OwnedSessionChatResult> {
  const { userId, sessionId, chatId, tenantId, forbiddenMessage = "Forbidden" } = params;

  const [sessionRecord, chat] = await Promise.all([
    sessionsDb.getSessionById(sessionId, tenantId),
    sessionsDb.getChatById(chatId, tenantId),
  ]);

  if (!sessionRecord) {
    return {
      ok: false,
      response: toErrorResponse("Session not found", 404),
    };
  }

  if (sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403),
    };
  }

  // Tenant mismatch check (defense-in-depth)
  if (tenantId && sessionRecord.tenantId && sessionRecord.tenantId !== tenantId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403),
    };
  }

  if (!chat || chat.sessionId !== sessionId) {
    return {
      ok: false,
      response: toErrorResponse("Chat not found", 404),
    };
  }

  return {
    ok: true,
    sessionRecord,
    chat,
  };
}
