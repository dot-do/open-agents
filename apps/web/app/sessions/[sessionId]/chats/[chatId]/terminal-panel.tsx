"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionTerminalLaunchResponse } from "@/app/api/sessions/[sessionId]/terminal/route";

export const TERMINAL_HEARTBEAT_INTERVAL_MS = 60_000;

type TerminalPanelState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      terminalUrl: string;
    }
  | {
      status: "requires_restart";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

export function TerminalPanelView({ state }: { state: TerminalPanelState }) {
  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Launching terminal…
      </div>
    );
  }

  if (state.status === "requires_restart") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Terminal needs a sandbox restart
          </p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Failed to open terminal
          </p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      className="h-full min-h-0 w-full flex-1 border-0 bg-background"
      sandbox="allow-popups allow-scripts"
      src={state.terminalUrl}
      title="Session terminal"
    />
  );
}

async function parseLaunchError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to a generic error.
  }

  return `Request failed with status ${response.status}`;
}

export function TerminalPanel({
  sessionId,
  onTerminalUrlChange,
}: {
  sessionId: string;
  onTerminalUrlChange?: (terminalUrl: string | null) => void;
}) {
  const [state, setState] = useState<TerminalPanelState>({ status: "loading" });
  const readyTerminalUrl = state.status === "ready" ? state.terminalUrl : null;

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    async function launchTerminal() {
      setState({ status: "loading" });

      try {
        const response = await fetch(`/api/sessions/${sessionId}/terminal`, {
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await parseLaunchError(response));
        }

        const body = (await response.json()) as
          | SessionTerminalLaunchResponse
          | undefined;

        if (!isMounted || !body) {
          return;
        }

        if (body.status === "ready") {
          setState({ status: "ready", terminalUrl: body.terminalUrl });
          return;
        }

        setState({
          status: "requires_restart",
          message: body.message,
        });
      } catch (error) {
        if (controller.signal.aborted || !isMounted) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to launch terminal",
        });
      }
    }

    void launchTerminal();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!onTerminalUrlChange) {
      return;
    }

    onTerminalUrlChange(readyTerminalUrl);
  }, [onTerminalUrlChange, readyTerminalUrl]);

  useEffect(() => {
    if (!onTerminalUrlChange) {
      return;
    }

    return () => {
      onTerminalUrlChange(null);
    };
  }, [onTerminalUrlChange]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        await fetch(`/api/sessions/${sessionId}/terminal/activity`, {
          method: "POST",
        });
      } catch {
        // Ignore transient heartbeat failures; the next interval will retry.
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, TERMINAL_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [sessionId, state.status]);

  return <TerminalPanelView state={state} />;
}
