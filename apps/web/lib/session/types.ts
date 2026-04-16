export type SessionRole = "owner" | "admin" | "member" | "viewer";

export interface Session {
  created: number;
  authProvider: "vercel" | "github";
  user: {
    id: string;
    username: string;
    email: string | undefined;
    avatar: string;
    name?: string;
  };
  /**
   * Tenant the user is currently acting as. Added in the tenant-context wave.
   * May be undefined on sessions issued before that wave — downstream code
   * (see `requireTenantCtx`) must fall back to the user's first membership.
   */
  activeTenantId?: string;
  /**
   * Role on `activeTenantId`. Same back-compat note as above.
   */
  role?: SessionRole;
  /**
   * When set, the session is impersonating another tenant on behalf of
   * the cross-tenant admin whose user id is recorded here. Only the
   * `/api/admin/tenants/[id]/impersonate` route sets this field; the UI
   * surfaces a banner so the operator never forgets they are not in
   * their own session. Cleared by `/api/admin/stop-impersonating`.
   */
  impersonatedBy?: string;
}

export interface SessionUserInfo {
  user: Session["user"] | undefined;
  authProvider?: "vercel" | "github";
  hasGitHub?: boolean;
  hasGitHubAccount?: boolean;
  hasGitHubInstallations?: boolean;
  /**
   * Active tenant for the session — surfaced to the client so tenant-aware
   * UIs (e.g. the GitHub App install button) can pass it back when kicking
   * off tenant-scoped flows.
   */
  activeTenantId?: string;
  /**
   * Set when an admin is impersonating this tenant. The UI uses this to
   * render the "you are impersonating" banner and the Stop button.
   */
  impersonatedBy?: string;
}
