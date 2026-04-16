import { permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { resolveTenantSlugFromUsername } from "@/lib/username-to-tenant";

/**
 * Legacy-route redirect shim.
 *
 * When `DISABLE_LEGACY_USERNAME_ROUTES` is truthy (default), resolve the
 * username to its primary tenant slug and 308-redirect into the
 * `/t/[tenantSlug]/...` tree, preserving the rest of the path + search.
 * When the flag is `"false"`, fall through to the original upstream
 * `/[username]` pages untouched — handy for upstream-alignment debugging.
 *
 * The actual `/[username]` pages remain on disk so deep-link resolution
 * and upstream merges stay cheap.
 */
export default async function LegacyUsernameLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const flag = process.env.DISABLE_LEGACY_USERNAME_ROUTES ?? "true";
  if (flag.toLowerCase() === "false") {
    return <>{children}</>;
  }

  const { username } = await params;
  const slug = await resolveTenantSlugFromUsername(username);
  if (!slug) {
    // Unknown user / no tenant — let the inner page render (likely 404).
    return <>{children}</>;
  }

  const h = await headers();
  // `x-invoke-path` / `next-url` aren't standardised; best-effort reconstruction.
  const incomingPath =
    h.get("x-invoke-path") ?? h.get("x-matched-path") ?? `/${username}`;
  const search = h.get("x-invoke-query") ?? "";

  // Strip the leading `/[username]` from the incoming path, keep the suffix.
  const prefix = `/${username}`;
  const suffix = incomingPath.startsWith(prefix)
    ? incomingPath.slice(prefix.length)
    : "";
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";

  permanentRedirect(`/t/${slug}${suffix}${qs}`);
}
