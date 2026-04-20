import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionsRouteShell } from "./sessions-route-shell";

type SessionsLayoutProps = {
  children: ReactNode;
};

export default async function SessionsLayout({
  children,
}: SessionsLayoutProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const tenantId = session.activeTenantId;

  const [lastRepo, sessions, archivedCount] = await Promise.all([
    getLastRepoByUserId(session.user.id, tenantId),
    getSessionsWithUnreadByUserId(session.user.id, { status: "active" }, tenantId),
    getArchivedSessionCountByUserId(session.user.id, tenantId),
  ]);

  return (
    <SessionsRouteShell
      currentUser={session.user}
      initialSessionsData={{ sessions, archivedCount }}
      lastRepo={lastRepo}
    >
      {children}
    </SessionsRouteShell>
  );
}
