import { filterModelsForSession } from "@/lib/model-access";
import { filterAllowedModels } from "@/lib/model-gate";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import { getServerSession } from "@/lib/session/get-server-session";
import { resolveTenantId } from "@/lib/session/resolve-tenant";

const CACHE_CONTROL = "private, no-store";

export async function GET(req: Request) {
  try {
    const [session, allModels] = await Promise.all([
      getServerSession(),
      fetchAvailableLanguageModelsWithContext(),
    ]);

    // Apply existing managed-template restrictions first.
    let models = filterModelsForSession(allModels, session, req.url);

    // Plan-aware filtering: only show models the tenant's plan allows.
    let plan: string | undefined;
    const tenantId = await resolveTenantId(session);
    if (tenantId) {
      const result = await filterAllowedModels({ tenantId }, models);
      models = result.models;
      plan = result.plan;
    }

    return Response.json(
      { models, plan },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch available models:", error);
    return Response.json(
      { error: "Failed to fetch available models" },
      { status: 500 },
    );
  }
}
