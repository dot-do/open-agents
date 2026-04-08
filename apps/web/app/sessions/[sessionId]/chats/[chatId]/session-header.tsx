"use client";

import {
  ExternalLink,
  Link2,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useGitPanel } from "./git-panel-context";
import { useSessionLayout } from "@/app/sessions/[sessionId]/session-layout-context";

/**
 * Session header that uses only layout-level data (persists across chat switches).
 * Sandbox-specific props are removed to prevent layout shift during navigation.
 */
export function SessionHeader() {
  const { toggleSidebar } = useSidebar();
  const { gitPanelOpen, toggleGitPanel, setShareRequested } = useGitPanel();
  const { session } = useSessionLayout();

  return (
    <header className="border-b border-border px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        {/* Left side: panel toggle + repo/branch + title */}
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={toggleSidebar}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
          </Tooltip>

          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {session.repoName && (
              <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
                {session.cloneUrl ? (
                  /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                  <a
                    href={`https://github.com/${session.repoOwner}/${session.repoName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 truncate font-medium text-foreground hover:underline"
                  >
                    {session.repoName}
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <span className="truncate font-medium text-foreground">
                    {session.repoName}
                  </span>
                )}
                {session.branch && (
                  <>
                    <span className="text-muted-foreground/40">/</span>
                    <span className="truncate text-muted-foreground">
                      {session.branch}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground/40">/</span>
              </div>
            )}
            <span className="truncate font-medium text-foreground sm:font-normal sm:text-muted-foreground">
              {session.title}
            </span>

            {/* Share link icon */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setShareRequested(true)}
                  className="ml-1 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Share chat</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Right side: git panel toggle */}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 shrink-0",
                  gitPanelOpen && "bg-accent text-accent-foreground",
                )}
                onClick={toggleGitPanel}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle git panel</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
