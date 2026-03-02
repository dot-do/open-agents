"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { Chat, Session } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

export type SessionWithUnread = Session & {
  hasUnread: boolean;
  hasStreaming: boolean;
};

interface CreateSessionInput {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: "hybrid" | "vercel" | "just-bash";
}

interface SessionsResponse {
  sessions: SessionWithUnread[];
}

interface CreateSessionResponse {
  session: Session;
  chat: Chat;
}

interface UseSessionsOptions {
  enabled?: boolean;
  initialData?: SessionWithUnread[];
}

type SessionStreamingOverlay = {
  setAt: number;
  seenServerStreaming: boolean;
};

const STREAMING_RACE_GRACE_MS = 4_000;
const STREAMING_REFRESH_INTERVAL_MS = 1_000;
const IDLE_REFRESH_INTERVAL_MS = 8_000;
const UNFOCUSED_REFRESH_INTERVAL_MS = 15_000;

const sessionStreamingOverlays = new Map<string, SessionStreamingOverlay>();

function overlaysEqual(
  left: SessionStreamingOverlay | undefined,
  right: SessionStreamingOverlay,
): boolean {
  return (
    left?.setAt === right.setAt &&
    left?.seenServerStreaming === right.seenServerStreaming
  );
}

export function useSessions(options?: UseSessionsOptions) {
  const enabled = options?.enabled ?? true;
  const [, setOverlayVersion] = useState(0);
  const lastNonEmptySessionsRef = useRef<SessionWithUnread[]>([]);
  const { mutate: globalMutate } = useSWRConfig();
  const fallbackData = options?.initialData
    ? { sessions: options.initialData }
    : undefined;

  const { data, error, isLoading, mutate } = useSWR<SessionsResponse>(
    enabled ? "/api/sessions" : null,
    fetcher,
    {
      fallbackData,
      revalidateOnMount: fallbackData ? false : undefined,
      refreshInterval: (latestData) => {
        const hasStreamingSession =
          latestData?.sessions.some((session) => session.hasStreaming) ?? false;
        const hasOptimisticStreaming = sessionStreamingOverlays.size > 0;

        if (hasStreamingSession || hasOptimisticStreaming) {
          return STREAMING_REFRESH_INTERVAL_MS;
        }

        if (typeof document !== "undefined" && !document.hasFocus()) {
          return UNFOCUSED_REFRESH_INTERVAL_MS;
        }

        return IDLE_REFRESH_INTERVAL_MS;
      },
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    },
  );

  const mergedSessions = (data?.sessions ?? []).map((session) => {
    const overlay = sessionStreamingOverlays.get(session.id);
    if (!overlay || session.hasStreaming) {
      return session;
    }

    return {
      ...session,
      hasStreaming: true,
    };
  });

  useEffect(() => {
    if (mergedSessions.length > 0) {
      lastNonEmptySessionsRef.current = mergedSessions;
      return;
    }

    if (!enabled) {
      lastNonEmptySessionsRef.current = [];
    }
  }, [enabled, mergedSessions]);

  const sessions =
    mergedSessions.length === 0 &&
    isLoading &&
    lastNonEmptySessionsRef.current.length > 0
      ? lastNonEmptySessionsRef.current
      : mergedSessions;
  const loading = isLoading && sessions.length === 0;

  useEffect(() => {
    if (!data?.sessions || sessionStreamingOverlays.size === 0) {
      return;
    }

    const sessionsById = new Map(
      data.sessions.map((session) => [session.id, session]),
    );
    let changed = false;

    for (const [sessionId, overlay] of sessionStreamingOverlays) {
      const session = sessionsById.get(sessionId);

      if (!session) {
        sessionStreamingOverlays.delete(sessionId);
        changed = true;
        continue;
      }

      if (session.hasStreaming) {
        if (!overlay.seenServerStreaming) {
          const nextOverlay: SessionStreamingOverlay = {
            ...overlay,
            seenServerStreaming: true,
          };
          sessionStreamingOverlays.set(sessionId, nextOverlay);
          changed = true;
        }
        continue;
      }

      const ageMs = Date.now() - overlay.setAt;
      if (overlay.seenServerStreaming || ageMs > STREAMING_RACE_GRACE_MS) {
        sessionStreamingOverlays.delete(sessionId);
        changed = true;
      }
    }

    if (changed) {
      setOverlayVersion((value) => value + 1);
    }
  }, [data?.sessions]);

  const setSessionStreaming = useCallback(
    async (sessionId: string, isStreaming: boolean) => {
      if (isStreaming) {
        const nextOverlay: SessionStreamingOverlay = {
          setAt: Date.now(),
          seenServerStreaming: false,
        };
        if (
          !overlaysEqual(sessionStreamingOverlays.get(sessionId), nextOverlay)
        ) {
          sessionStreamingOverlays.set(sessionId, nextOverlay);
          setOverlayVersion((value) => value + 1);
        }
      } else if (sessionStreamingOverlays.delete(sessionId)) {
        setOverlayVersion((value) => value + 1);
      }

      await globalMutate<SessionsResponse>(
        "/api/sessions",
        (current) =>
          current
            ? {
                sessions: current.sessions.map((session) =>
                  session.id === sessionId
                    ? { ...session, hasStreaming: isStreaming }
                    : session,
                ),
              }
            : current,
        { revalidate: false },
      );
    },
    [globalMutate],
  );

  const createSession = async (input: CreateSessionInput) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const responseData = (await res.json()) as {
      session?: Session;
      chat?: Chat;
      error?: string;
    };

    if (!res.ok || !responseData.session || !responseData.chat) {
      throw new Error(responseData.error ?? "Failed to create session");
    }

    const createdSession = responseData.session;
    const createdChat = responseData.chat;

    // Pre-seed the session chats SWR cache so the sidebar shows the
    // initial chat immediately on navigation instead of waiting for a
    // fresh fetch.
    void globalMutate(
      `/api/sessions/${createdSession.id}/chats`,
      {
        chats: [
          {
            ...createdChat,
            hasUnread: false,
            isStreaming: false,
          },
        ],
        defaultModelId: createdChat.modelId,
      },
      { revalidate: false },
    );

    await mutate(
      {
        sessions: [
          { ...createdSession, hasUnread: false, hasStreaming: false },
          ...sessions,
        ],
      },
      { revalidate: false },
    );

    return {
      session: createdSession,
      chat: createdChat,
    } satisfies CreateSessionResponse;
  };

  const archiveSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const responseData = (await res.json()) as {
      session?: Session;
      error?: string;
    };

    if (!res.ok) {
      throw new Error(responseData.error ?? "Failed to archive session");
    }

    if (responseData.session) {
      const updatedSession = responseData.session;
      await mutate(
        (current) => ({
          sessions: (current?.sessions ?? []).map((s) =>
            s.id === sessionId
              ? {
                  ...updatedSession,
                  hasUnread: s.hasUnread,
                  hasStreaming: s.hasStreaming,
                }
              : s,
          ),
        }),
        { revalidate: false },
      );
    }

    return responseData.session;
  };

  return {
    sessions,
    loading,
    error,
    createSession,
    archiveSession,
    setSessionStreaming,
    refreshSessions: mutate,
  };
}
