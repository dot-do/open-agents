import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { lookupTenantBySlug } from "@/lib/db/tenants";

export const dynamic = "force-dynamic";

/**
 * Tenant home page. Shows the 20 most recent sessions attributed to the
 * tenant. Access is enforced by the sibling `layout.tsx`; this page only
 * re-fetches the tenant row to read its id/name.
 */
export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await lookupTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const recent = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.tenantId, tenant.id))
    .orderBy(desc(sessions.createdAt))
    .limit(20);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Tenant
        </div>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <div className="text-sm text-muted-foreground">{tenant.slug}</div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Recent sessions
        </h2>
        {recent.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No sessions yet for this tenant.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {recent.map((s) => {
              const repo =
                s.repoOwner && s.repoName
                  ? `${s.repoOwner}/${s.repoName}`
                  : null;
              return (
                <li key={s.id}>
                  <Link
                    href={`/sessions/${s.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {s.title || "Untitled session"}
                      </div>
                      {repo ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {repo}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-xs uppercase text-muted-foreground">
                      {s.status}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
