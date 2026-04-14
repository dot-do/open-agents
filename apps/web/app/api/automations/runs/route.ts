import {
  listAutomationRunsByUserId,
  listAutomationsByUserId,
} from "@/lib/db/automations";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const [runs, automations] = await Promise.all([
    listAutomationRunsByUserId(authResult.userId, 50),
    listAutomationsByUserId(authResult.userId),
  ]);

  const automationNames = new Map(automations.map((a) => [a.id, a.name]));

  return Response.json({
    runs: runs.map((run) => ({
      ...run,
      automationName: automationNames.get(run.automationId) ?? "Unknown",
    })),
  });
}
