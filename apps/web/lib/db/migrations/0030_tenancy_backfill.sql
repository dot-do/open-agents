-- Tenancy backfill: create a personal tenant per user, an owner membership,
-- and populate the nullable tenant_id columns on all tenant-scoped tables.
-- Slug collisions are resolved by appending -<n> where n is a monotonically
-- increasing integer per conflicting username.

-- 1. Personal tenants (one per user). Slug defaults to username; if that
--    collides we append -<row_number> within the collision group.
WITH ranked AS (
  SELECT
    u.id           AS user_id,
    u.username     AS username,
    COALESCE(NULLIF(u.name, ''), u.username) AS display_name,
    ROW_NUMBER() OVER (PARTITION BY u.username ORDER BY u.created_at, u.id) AS rn
  FROM users u
)
INSERT INTO tenants (id, slug, name, created_at, updated_at)
SELECT
  'ten_' || r.user_id                                    AS id,
  CASE WHEN r.rn = 1 THEN r.username
       ELSE r.username || '-' || r.rn::text END          AS slug,
  r.display_name                                         AS name,
  now(),
  now()
FROM ranked r
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- 2. Owner membership per user for their personal tenant.
INSERT INTO memberships (tenant_id, user_id, role, created_at)
SELECT 'ten_' || u.id, u.id, 'owner', now()
FROM users u
ON CONFLICT (tenant_id, user_id) DO NOTHING;
--> statement-breakpoint

-- 3. Direct-owned tables (have user_id).
UPDATE sessions             SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE github_installations SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE vercel_project_links SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE linked_accounts      SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE user_preferences     SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE usage_events         SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint
UPDATE workflow_runs        SET tenant_id = 'ten_' || user_id WHERE tenant_id IS NULL;
--> statement-breakpoint

-- 4. Indirect-owned tables.
-- chats → sessions.user_id
UPDATE chats c
SET tenant_id = 'ten_' || s.user_id
FROM sessions s
WHERE c.session_id = s.id AND c.tenant_id IS NULL;
--> statement-breakpoint

-- chat_messages → chats.session_id → sessions.user_id
UPDATE chat_messages m
SET tenant_id = 'ten_' || s.user_id
FROM chats c
JOIN sessions s ON s.id = c.session_id
WHERE m.chat_id = c.id AND m.tenant_id IS NULL;
--> statement-breakpoint

-- shares → chats.session_id → sessions.user_id
UPDATE shares sh
SET tenant_id = 'ten_' || s.user_id
FROM chats c
JOIN sessions s ON s.id = c.session_id
WHERE sh.chat_id = c.id AND sh.tenant_id IS NULL;
--> statement-breakpoint

-- workflow_run_steps → workflow_runs.user_id
UPDATE workflow_run_steps st
SET tenant_id = 'ten_' || r.user_id
FROM workflow_runs r
WHERE st.workflow_run_id = r.id AND st.tenant_id IS NULL;
