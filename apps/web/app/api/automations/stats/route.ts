import {
  listAutomationsByUserId,
  getAutomationRunStats,
} from "@/lib/db/automations";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const [automations, runStats] = await Promise.all([
    listAutomationsByUserId(authResult.userId),
    getAutomationRunStats(authResult.userId),
  ]);

  return Response.json({
    totalAutomations: automations.length,
    enabledAutomations: automations.filter((a) => a.enabled).length,
    runs7d: runStats,
  });
}
