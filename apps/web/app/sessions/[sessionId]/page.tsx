import { notFound, redirect } from "next/navigation";
import { getChatsBySessionId } from "@/lib/db/sessions";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { getServerSession } from "@/lib/session/get-server-session";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;

  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const tenantId = session.activeTenantId;
  const sessionRecord = await getSessionByIdCached(sessionId, tenantId);
  if (!sessionRecord) {
    notFound();
  }

  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  const chats = await getChatsBySessionId(sessionId, tenantId);
  const targetChat = chats[0];

  if (!targetChat) {
    notFound();
  }

  redirect(`/sessions/${sessionId}/chats/${targetChat.id}`);
}
