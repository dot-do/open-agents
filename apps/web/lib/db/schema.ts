import type { SandboxState } from "@open-harness/sandbox";
import type { ModelVariant } from "@/lib/model-variants";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Tenancy note: all mutating queries in app/api that touch tenant-scoped
// tables MUST go through `withTenant` / `requireTenantCtx` from
// `apps/web/lib/db/tenant-context.ts`. Adding new tenant-scoped tables?
// Add a `tenantId` column + composite index and route writes through the
// tenant guard helpers.
//
// Wave 3 additions: for new tenant-scoped tables, prefer routing queries
// through `scopedQuery(ctx)` / `enforceTenantEq` in
// `apps/web/lib/db/tenant-guard.ts`. That helper auto-injects
// `eq(table.tenantId, ctx.tenantId)` into selects/updates/deletes and
// asserts tenant match on single-row reads in dev. It's a thin convenience
// wrapper on top of Drizzle — not a replacement for the query builder.
// Defense-in-depth: Postgres RLS policies live in `0034_tenant_rls.sql`
// and are primed per-tx by `setTenantContext(db, tenantId)` in
// `apps/web/lib/db/rls.ts`; query-layer guard remains primary.

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("tenants_slug_idx").on(table.slug)],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    provider: text("provider", {
      enum: ["github", "vercel"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scope: text("scope"),
    username: text("username").notNull(),
    email: text("email"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    tokenExpiresAt: timestamp("token_expires_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_provider_external_id_idx").on(
      table.provider,
      table.externalId,
    ),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["owner", "admin", "member", "viewer"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["github"],
    })
      .notNull()
      .default("github"),
    externalUserId: text("external_user_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    scope: text("scope"),
    username: text("username").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("accounts_user_id_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    installationUrl: text("installation_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_user_installation_idx").on(
      table.userId,
      table.installationId,
    ),
    uniqueIndex("github_installations_user_account_idx").on(
      table.userId,
      table.accountLogin,
    ),
    index("github_installations_tenant_user_idx").on(
      table.tenantId,
      table.userId,
    ),
  ],
);

export const vercelProjectLinks = pgTable(
  "vercel_project_links",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    teamId: text("team_id"),
    teamSlug: text("team_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.repoOwner, table.repoName],
    }),
    index("vercel_project_links_tenant_user_idx").on(
      table.tenantId,
      table.userId,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "archived"],
    })
      .notNull()
      .default("running"),
    // Repository info
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch"),
    cloneUrl: text("clone_url"),
    vercelProjectId: text("vercel_project_id"),
    vercelProjectName: text("vercel_project_name"),
    vercelTeamId: text("vercel_team_id"),
    vercelTeamSlug: text("vercel_team_slug"),
    // Whether this session uses a new auto-generated branch
    isNewBranch: boolean("is_new_branch").default(false).notNull(),
    // Optional per-session override for auto commit + push behavior.
    // null means "use the user's default preference".
    autoCommitPushOverride: boolean("auto_commit_push_override"),
    // Optional per-session override for auto PR creation after auto-commit.
    // null means "use the user's default preference".
    autoCreatePrOverride: boolean("auto_create_pr_override"),
    globalSkillRefs: jsonb("global_skill_refs")
      .$type<GlobalSkillRef[]>()
      .notNull()
      .default([]),
    // Unified sandbox state
    sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
    // Lifecycle orchestration state for sandbox management
    lifecycleState: text("lifecycle_state", {
      enum: [
        "provisioning",
        "active",
        "hibernating",
        "hibernated",
        "restoring",
        "archived",
        "failed",
      ],
    }),
    lifecycleVersion: integer("lifecycle_version").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    sandboxExpiresAt: timestamp("sandbox_expires_at"),
    hibernateAfter: timestamp("hibernate_after"),
    lifecycleRunId: text("lifecycle_run_id"),
    lifecycleError: text("lifecycle_error"),
    // Git stats (for display in session list)
    linesAdded: integer("lines_added").default(0),
    linesRemoved: integer("lines_removed").default(0),
    // PR info if created
    prNumber: integer("pr_number"),
    prStatus: text("pr_status", {
      enum: ["open", "merged", "closed"],
    }),
    // Snapshot info (for cached snapshots feature)
    snapshotUrl: text("snapshot_url"),
    snapshotCreatedAt: timestamp("snapshot_created_at"),
    snapshotSizeBytes: integer("snapshot_size_bytes"),
    // Cached diff for offline viewing
    cachedDiff: jsonb("cached_diff"),
    cachedDiffUpdatedAt: timestamp("cached_diff_updated_at"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    title: text("title").notNull(),
    modelId: text("model_id").default("anthropic/claude-haiku-4.5"),
    activeStreamId: text("active_stream_id"),
    lastAssistantMessageAt: timestamp("last_assistant_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("chats_session_id_idx").on(table.sessionId),
    index("chats_tenant_session_idx").on(table.tenantId, table.sessionId),
  ],
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shares_chat_id_idx").on(table.chatId),
    index("shares_tenant_chat_idx").on(table.tenantId, table.chatId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    role: text("role", {
      enum: ["user", "assistant"],
    }).notNull(),
    // Store the full message parts as JSON for flexibility
    parts: jsonb("parts").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_tenant_chat_idx").on(table.tenantId, table.chatId),
  ],
);

export const chatReads = pgTable(
  "chat_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chatId] }),
    index("chat_reads_chat_id_idx").on(table.chatId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    modelId: text("model_id"),
    status: text("status", {
      enum: ["completed", "aborted", "failed"],
    }).notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    totalDurationMs: integer("total_duration_ms").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_runs_chat_id_idx").on(table.chatId),
    index("workflow_runs_session_id_idx").on(table.sessionId),
    index("workflow_runs_user_id_idx").on(table.userId),
    index("workflow_runs_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    stepNumber: integer("step_number").notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_run_steps_run_id_idx").on(table.workflowRunId),
    uniqueIndex("workflow_run_steps_run_step_idx").on(
      table.workflowRunId,
      table.stepNumber,
    ),
    index("workflow_run_steps_tenant_run_idx").on(
      table.tenantId,
      table.workflowRunId,
    ),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VercelProjectLink = typeof vercelProjectLinks.$inferSelect;
export type NewVercelProjectLink = typeof vercelProjectLinks.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatRead = typeof chatReads.$inferSelect;
export type NewChatRead = typeof chatReads.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type NewWorkflowRunStep = typeof workflowRunSteps.$inferInsert;
export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;

// Linked accounts for external platforms (Slack, Discord, etc.)
export const linkedAccounts = pgTable(
  "linked_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    provider: text("provider", {
      enum: ["slack", "discord", "whatsapp", "telegram"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    workspaceId: text("workspace_id"), // For Slack workspaces, Discord servers
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linked_accounts_provider_external_workspace_idx").on(
      table.provider,
      table.externalId,
      table.workspaceId,
    ),
    index("linked_accounts_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export type LinkedAccount = typeof linkedAccounts.$inferSelect;
export type NewLinkedAccount = typeof linkedAccounts.$inferInsert;

// User preferences for settings
export const userPreferences = pgTable(
  "user_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    defaultModelId: text("default_model_id").default(
      "anthropic/claude-haiku-4.5",
    ),
    defaultSubagentModelId: text("default_subagent_model_id"),
    defaultSandboxType: text("default_sandbox_type", {
      enum: ["vercel"],
    }).default("vercel"),
    defaultDiffMode: text("default_diff_mode", {
      enum: ["unified", "split"],
    }).default("unified"),
    autoCommitPush: boolean("auto_commit_push").notNull().default(false),
    autoCreatePr: boolean("auto_create_pr").notNull().default(false),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    alertSoundEnabled: boolean("alert_sound_enabled").notNull().default(true),
    publicUsageEnabled: boolean("public_usage_enabled")
      .notNull()
      .default(false),
    globalSkillRefs: jsonb("global_skill_refs")
      .$type<GlobalSkillRef[]>()
      .notNull()
      .default([]),
    modelVariants: jsonb("model_variants")
      .$type<ModelVariant[]>()
      .notNull()
      .default([]),
    enabledModelIds: jsonb("enabled_model_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("user_preferences_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

// Usage tracking — one row per assistant turn (append-only)
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id),
    source: text("source", { enum: ["web"] })
      .notNull()
      .default("web"),
    agentType: text("agent_type", { enum: ["main", "subagent"] })
      .notNull()
      .default("main"),
    provider: text("provider"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_events_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Tenant quotas + usage counters (P0 sandbox isolation & cost control)
// ---------------------------------------------------------------------------
// Defaults are intentionally conservative so multi-tenant go-live cannot
// result in unbounded spend. Ops can raise limits per-tenant via the
// `admin:sandboxes` CLI or direct SQL. Rows are created lazily — absence
// implies default limits.
export const tenantQuotas = pgTable("tenant_quotas", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  maxConcurrentSandboxes: integer("max_concurrent_sandboxes")
    .notNull()
    .default(3),
  maxMonthlyMinutes: integer("max_monthly_minutes").notNull().default(600),
  maxDailyCostCents: integer("max_daily_cost_cents").notNull().default(500),
  hardKillEnabled: boolean("hard_kill_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TenantQuota = typeof tenantQuotas.$inferSelect;
export type NewTenantQuota = typeof tenantQuotas.$inferInsert;

export const tenantUsageCounters = pgTable(
  "tenant_usage_counters",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Period bucket — month start for monthly minutes, day start for daily cost.
    // Callers pick the granularity; a single row per (tenant, periodStart).
    periodStart: date("period_start").notNull(),
    sandboxMinutes: integer("sandbox_minutes").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.periodStart] }),
    index("tenant_usage_counters_tenant_idx").on(table.tenantId),
  ],
);

export type TenantUsageCounter = typeof tenantUsageCounters.$inferSelect;
export type NewTenantUsageCounter = typeof tenantUsageCounters.$inferInsert;

// ---------------------------------------------------------------------------
// Wave 3 — audit / billing / api keys / invites
// ---------------------------------------------------------------------------

// Append-only audit log for tenant-scoped actions. Feature agents write via
// a dedicated `audit(ctx, action, target, metadata?)` helper (wave 3B).
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_tenant_created_idx").on(
      table.tenantId,
      table.createdAt.desc(),
    ),
    index("audit_events_tenant_action_idx").on(table.tenantId, table.action),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// Tenant-scoped, BYOK provider API keys. `encryptedKey` is ciphertext
// produced by `apps/web/lib/crypto.ts#encrypt`. Plaintext is ONLY accessible
// via an explicit decrypt helper at read time — never via generic selects.
// `keyHint` stores the last 4 chars in plaintext for UI confirmation.
export const tenantApiKeys = pgTable(
  "tenant_api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["anthropic", "openai", "gateway", "google", "xai"],
    }).notNull(),
    label: text("label"),
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    uniqueIndex("tenant_api_keys_tenant_provider_label_idx").on(
      table.tenantId,
      table.provider,
      table.label,
    ),
    index("tenant_api_keys_tenant_idx").on(table.tenantId),
  ],
);

export type TenantApiKey = typeof tenantApiKeys.$inferSelect;
export type NewTenantApiKey = typeof tenantApiKeys.$inferInsert;

// Stripe customer + subscription mirror. One row per tenant.
export const tenantStripeCustomers = pgTable("tenant_stripe_customers", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  plan: text("plan", {
    enum: ["free", "pro", "team", "enterprise"],
  })
    .notNull()
    .default("free"),
  subscriptionStatus: text("subscription_status"),
  subscriptionId: text("subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TenantStripeCustomer = typeof tenantStripeCustomers.$inferSelect;
export type NewTenantStripeCustomer =
  typeof tenantStripeCustomers.$inferInsert;

// Tenant member invites. Role enum mirrors memberships.role.
export const tenantInvites = pgTable(
  "tenant_invites",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", {
      enum: ["owner", "admin", "member", "viewer"],
    }).notNull(),
    token: text("token").notNull().unique(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("tenant_invites_tenant_idx").on(table.tenantId),
    index("tenant_invites_email_idx").on(table.email),
  ],
);

export type TenantInvite = typeof tenantInvites.$inferSelect;
export type NewTenantInvite = typeof tenantInvites.$inferInsert;

// Tenant SSO configuration (P3, enterprise plan only).
// One row per tenant. The platform-side provider (WorkOS / Clerk /
// generic SAML) actually terminates the SSO handshake; this table stores
// the connection handle + the email domain used for auto-routing. The
// provider SDK is intentionally NOT a dependency — see
// `apps/web/lib/sso/index.ts` for the pluggable adapter interface.
export const tenantSsoConfigs = pgTable(
  "tenant_sso_configs",
  {
    tenantId: text("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["workos", "clerk", "saml-generic"],
    }).notNull(),
    connectionId: text("connection_id"),
    domain: text("domain"),
    enabled: boolean("enabled").notNull().default(false),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("tenant_sso_configs_domain_idx").on(table.domain)],
);

export type TenantSsoConfig = typeof tenantSsoConfigs.$inferSelect;
export type NewTenantSsoConfig = typeof tenantSsoConfigs.$inferInsert;

