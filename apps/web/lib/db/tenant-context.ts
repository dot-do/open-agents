import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { getSessionFromReq } from "@/lib/session/server";
import {
  lookupTokenByPlaintext,
  type TokenScope,
} from "@/lib/db/tenant-api-tokens";

/**
 * Tenancy query guard.
 *
 * CONTRACT: every mutating query in `app/api/**` that touches a tenant-scoped
 * table MUST derive its `tenantId` from `requireTenantCtx(req)` and pass the
 * resulting `TenantContext` into query helpers via `withTenant`. This keeps
 * tenant isolation enforceable at the call site rather than via ambient
 * globals. See `apps/web/lib/db/schema.ts` top-of-file note for the list of
 * tenant-scoped tables.
 *
 * `withTenant` is currently a thin passthrough — it exists to give query
 * callers a single place to hang auditing / RLS-style checks as the tenancy
 * model matures, without having to re-thread every call site later.
 */

export type Role = "owner" | "admin" | "member" | "viewer";

export type TenantContext = {
  tenantId: string;
  userId: string;
  role: Role;
  /**
   * How the caller authenticated. `pat` indicates a tenant-scoped Personal
   * Access Token (resolved by `requireTenantCtxFromBearer`); the absence of
   * `via` means "session cookie" (the default path through `requireTenantCtx`).
   * Used to tag audit/spans and to enforce scope on PAT-authenticated routes.
   */
  via?: "pat";
  /** PAT scope when `via === "pat"`; undefined for session-auth callers. */
  scope?: TokenScope;
  /**
   * `true` when `activeTenantId` from the session pointed to a tenant whose
   * membership was revoked, and the context fell back to the next available
   * membership. Route handlers should check this flag and refresh the session
   * cookie with the new `tenantId` so subsequent requests avoid the fallback.
   */
  stale?: boolean;
};

/**
 * Error codes returned by tenant-context helpers so API routes and UI can
 * distinguish recoverable situations from hard failures.
 *
 * - `no_auth`               — no session / unauthenticated
 * - `no_memberships`        — user exists but has zero tenant memberships
 * - `membership_revoked`    — activeTenantId pointed at a tenant the user
 *                             no longer belongs to (fallback succeeded)
 * - `access_denied`         — generic denial (PAT revoked, wrong tenant, etc.)
 */
export type TenantErrorCode =
  | "no_auth"
  | "no_memberships"
  | "membership_revoked"
  | "access_denied";

export class TenantAccessError extends Error {
  code: TenantErrorCode;
  /** Optional redirect hint for the frontend. */
  redirect?: string;

  constructor(
    message: string,
    code: TenantErrorCode = "access_denied",
    redirect?: string,
  ) {
    super(message);
    this.name = "TenantAccessError";
    this.code = code;
    this.redirect = redirect;
  }
}

/**
 * Resolve the active tenant for an incoming request.
 *
 * Prefers `session.activeTenantId` (set on login and by the tenant switcher).
 * For sessions issued before that field was added, falls back to the first
 * membership row — the user's personal tenant per 0030_tenancy_backfill.
 *
 * Even when the session carries an `activeTenantId`, we re-verify the
 * membership against the DB so a membership revoked mid-session is honored.
 */
export async function requireTenantCtx(
  req: NextRequest,
): Promise<TenantContext> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    throw new TenantAccessError(
      "No authenticated user on request",
      "no_auth",
      "/login",
    );
  }

  let staleFallback = false;
  const activeTenantId = session?.activeTenantId;
  if (activeTenantId) {
    const rows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.tenantId, activeTenantId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row) {
      return {
        tenantId: activeTenantId,
        userId,
        role: row.role as Role,
      };
    }
    // Session points at a tenant the user no longer belongs to — fall through
    // to the first-membership fallback rather than 403'ing on a stale cookie.
    // Structured log so observability tooling can track session refreshes.
    console.warn(
      JSON.stringify({
        event: "tenant.session.refreshed",
        userId,
        staleTenantId: activeTenantId,
        reason: "membership_revoked",
      }),
    );
    staleFallback = true;
  }

  // Fallback: pick the user's earliest membership.
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(memberships.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(
      `User ${userId} has no tenant memberships`,
      "no_memberships",
      "/create-workspace",
    );
  }

  if (staleFallback) {
    console.warn(
      JSON.stringify({
        event: "tenant.session.refreshed",
        userId,
        staleTenantId: activeTenantId,
        newTenantId: row.tenantId,
      }),
    );
  }

  return {
    tenantId: row.tenantId,
    userId,
    role: row.role as Role,
    ...(staleFallback ? { stale: true } : {}),
  };
}

/**
 * Assert that the caller's context matches an explicit tenantId — useful when
 * an API route receives a tenant id in the URL or request body.
 */
export async function assertTenantMember(
  userId: string,
  tenantId: string,
): Promise<Role> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(
      `User ${userId} is not a member of tenant ${tenantId}`,
    );
  }
  return row.role as Role;
}

/**
 * Thin passthrough today — see file-level contract note. Wrap tenant-scoped
 * query callbacks so the call site is syntactically marked as tenant-aware:
 *
 *   const rows = await withTenant(ctx, () =>
 *     db.select().from(sessions).where(eq(sessions.tenantId, ctx.tenantId)),
 *   );
 */
export async function withTenant<T>(
  _ctx: TenantContext,
  query: () => Promise<T>,
): Promise<T> {
  return query();
}

const SCOPE_RANK: Record<TokenScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * Per-route bearer-token resolver. The Next.js middleware runs in the Edge
 * runtime by default and `postgres-js` (our Drizzle driver) cannot run on
 * Edge — so PAT lookup must happen inside Node-runtime route handlers,
 * not in middleware. Routes that want to opt into PAT auth call this helper
 * BEFORE `requireTenantCtx` so a `Bearer oa_pat_…` header is honored
 * without a session cookie. Returns `null` when no usable bearer header is
 * present, letting the caller fall through to session-cookie auth.
 *
 * Resolved contexts are tagged `via: 'pat'` (and carry the token's `scope`)
 * so audit hooks and `requireScope` can distinguish programmatic clients
 * from interactive sessions.
 */
export async function requireTenantCtxFromBearer(
  req: NextRequest | Request,
): Promise<TenantContext | null> {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const plaintext = match[1];
  if (!plaintext) return null;
  const lookup = await lookupTokenByPlaintext(plaintext);
  if (!lookup) {
    throw new TenantAccessError("Invalid or revoked bearer token");
  }

  // PAT-scoped role mapping: a PAT acts on behalf of its creator but the
  // membership row is the source of truth for the user's role at request
  // time. If the creator was demoted or removed from the tenant since the
  // token was minted, refuse the request rather than silently honoring it.
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, lookup.userId),
        eq(memberships.tenantId, lookup.tenantId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(
      "Bearer token's creator is no longer a tenant member",
    );
  }

  return {
    tenantId: lookup.tenantId,
    userId: lookup.userId,
    role: row.role as Role,
    via: "pat",
    scope: lookup.scope,
  };
}

/**
 * Combined session-or-bearer resolver. Routes that accept both interactive
 * users and programmatic clients call this once at the top of the handler.
 * Bearer tokens are checked first so a request with both a cookie and an
 * Authorization header is treated as the (more restrictive) PAT call.
 */
export async function requireTenantCtxAny(
  req: NextRequest,
): Promise<TenantContext> {
  const bearer = await requireTenantCtxFromBearer(req);
  if (bearer) return bearer;
  return requireTenantCtx(req);
}

/**
 * Scope guard for PAT-authenticated requests. Session-cookie callers (no
 * `via`) bypass this check — their authorization is governed by the
 * existing role-based checks in each route. Throws `TenantAccessError` so
 * routes can render a uniform 403 via their existing catch.
 */
export function requireScope(ctx: TenantContext, min: TokenScope): void {
  if (ctx.via !== "pat" || !ctx.scope) return;
  if (SCOPE_RANK[ctx.scope] < SCOPE_RANK[min]) {
    throw new TenantAccessError(
      `PAT scope '${ctx.scope}' insufficient — '${min}' or higher required`,
    );
  }
}

/**
 * Build a structured JSON Response from a TenantAccessError. Use this in API
 * route catch blocks instead of returning a bare `{ error: string }` so
 * frontend callers can programmatically redirect users to recovery flows.
 *
 * ```ts
 * } catch (err) {
 *   if (err instanceof TenantAccessError) return tenantErrorResponse(err);
 *   throw err;
 * }
 * ```
 */
export function tenantErrorResponse(err: TenantAccessError): Response {
  const status = err.code === "no_auth" ? 401 : 403;
  return Response.json(
    {
      error: err.code,
      message: err.message,
      ...(err.redirect ? { redirect: err.redirect } : {}),
    },
    { status },
  );
}
