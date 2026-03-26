Summary: Add Slack as a first-class chat surface using Chat SDK so `@openharness` can create or continue Open Harness chats from Slack threads. The Slack thread becomes the external transport for an owned Open Harness chat, with account linking on first use, chat-scoped share links back to web, per-thread placeholder/edit behavior in Slack, and Slack-origin badges on user messages in the web UI.

Context: Existing session creation already supports all three startup modes we need in Slack: blank sandbox when no repo is provided, fixed branch when `branch` is present, and auto-generated branch when `isNewBranch` is true ([apps/web/app/api/sessions/route.ts](#workspace-file=apps/web/app/api/sessions/route.ts)). Chat runs are started through the web chat route and durable workflow pipeline ([apps/web/app/api/chat/route.ts](#workspace-file=apps/web/app/api/chat/route.ts), [apps/web/app/workflows/chat.ts](#workspace-file=apps/web/app/workflows/chat.ts), [apps/web/app/workflows/chat-post-finish.ts](#workspace-file=apps/web/app/workflows/chat-post-finish.ts)). Chat messages are stored as full UI-message JSON in `chat_messages.parts`, so Slack-origin metadata can ride inside the persisted message object without a dedicated message-column migration ([apps/web/lib/db/schema.ts](#workspace-file=apps/web/lib/db/schema.ts), [apps/web/app/sessions/[sessionId]/chats/[chatId]/page.tsx](#workspace-file=apps/web/app/sessions/[sessionId]/chats/[chatId]/page.tsx)). A generic `linked_accounts` table already exists and is the right place to map Slack users to Open Harness users ([apps/web/lib/db/schema.ts](#workspace-file=apps/web/lib/db/schema.ts), [apps/web/lib/db/linked-accounts.ts](#workspace-file=apps/web/lib/db/linked-accounts.ts)). Chat-scoped public share links already exist and are a good fit for the Slack-to-web handoff ([apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts](#workspace-file=apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts)). Chat SDK is not installed yet, so this plan assumes adding `chat`, `@chat-adapter/slack`, and a Chat SDK state adapter.

Approach: Keep Open Harness as the source of truth for sessions, chats, sandboxes, and persisted messages, and use Slack/Chat SDK only as an external transport layer. Introduce a Slack thread mapping table so one Slack thread maps to one Open Harness chat, plus a short-lived Slack link-request table for first-use account linking and optional deferred session creation. Extract the core "start a chat run" logic from the web chat route into a reusable server module so Slack can create user messages, ensure sandbox/session readiness, and start the same durable workflow without duplicating route logic. Parse Slack mention text for an optional `repo=owner/repo#branch` token (explicit branch), `repo=owner/repo` token (new generated branch), or no repo token (blank sandbox); the remaining text becomes the user prompt. On inbound Slack mention/reply, immediately send or edit a lightweight Slack placeholder containing the web share URL, then update that same Slack bot message with the final assistant text once the workflow persists the completed assistant message. Persist Slack-origin metadata on the user message so the web UI can render italic "sent with Slack" beneath those messages.

Changes:
- `package.json` - add Chat SDK workspace dependency entries if needed for root-level resolution.
- `apps/web/package.json` - add `chat`, `@chat-adapter/slack`, and the chosen Chat SDK state adapter.
- `apps/web/lib/db/schema.ts` - add Slack-specific persistence for thread mappings and short-lived link requests; expand usage source enum if we want Slack usage split in analytics.
- `apps/web/lib/db/linked-accounts.ts` - add Slack-friendly upsert/find helpers keyed by provider + externalId + workspaceId.
- `apps/web/lib/db/slack-threads.ts` (new) - store `workspaceId + channelId + threadTs -> userId/sessionId/chatId`, plus the currently pending Slack bot reply timestamp used for final edits.
- `apps/web/lib/db/slack-link-requests.ts` (new) - create/consume expiring link requests that capture Slack user/workspace identity and the initial pending mention payload.
- `apps/web/lib/slack/parse-session-intent.ts` (new) - parse and validate `repo=owner/repo#branch`, `repo=owner/repo`, or blank-sandbox input; strip the token from the prompt.
- `apps/web/lib/slack/chat-sdk.ts` (new) - initialize the Chat SDK bot with the Slack adapter and state adapter, wire mention/reply handlers, and expose a webhook handler for Next.js.
- `apps/web/lib/slack/message-sync.ts` (new) - create/edit Slack placeholder replies, derive final assistant plain text from persisted message parts, and manage share-link generation.
- `apps/web/lib/chat/start-chat-run.ts` (new) - shared server-side helper that persists the latest user message, validates ownership/sandbox state, and starts the durable workflow for both web and Slack callers.
- `apps/web/app/api/chat/route.ts` - delegate to the shared start-chat-run helper instead of owning all orchestration inline.
- `apps/web/app/api/slack/route.ts` (new) - Slack webhook endpoint that hands requests to Chat SDK.
- `apps/web/app/slack/link/page.tsx` (new) - account-link landing page that either completes Slack linking for an authenticated user or prompts sign-in and resumes on return.
- `apps/web/app/api/auth/info/route.ts` - optionally return linked Slack account summary so settings/UI can reflect account state.
- `apps/web/app/settings/accounts-section.tsx` - show linked Slack account status and unlink action alongside GitHub account state.
- `apps/web/app/workflows/chat-post-finish.ts` - after assistant persistence, update the mapped Slack placeholder message with the final assistant text and clear pending Slack reply state.
- `apps/web/app/types.ts` - extend message metadata with a transport/source field (for example `originSurface?: "slack"`).
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` - render italic "sent with Slack" under Slack-originated user messages.
- `apps/web/app/shared/[shareId]/shared-chat-content.tsx` - optionally render the same Slack-origin treatment on shared pages for consistency.
- `apps/web/app/api/slack/route.test.ts` (new) - cover new-thread creation, linked-account enforcement, continuation in an existing thread, placeholder/share-link behavior, and repo token parsing.
- `apps/web/lib/slack/parse-session-intent.test.ts` (new) - cover explicit branch, generated branch, blank sandbox, invalid repo token, and prompt stripping.
- `apps/web/app/api/chat/route.test.ts` - update for the extracted shared run-start helper.
- `apps/web/app/shared/[shareId]/page.test.ts` - cover Slack-origin metadata surviving through the shared page render path.
- `apps/web/drizzle/*` (generated) - migration(s) for the new Slack tables and any enum/schema expansion.

Verification:
- Unit-test parsing for `repo=owner/repo#branch`, `repo=owner/repo`, and no repo token.
- Unit/integration-test Slack webhook handling for: first-time unlinked mention, successful link completion, new-thread session creation, follow-up reply in same thread, and invalid repo token.
- Validate end-to-end that a Slack-created thread produces a chat-scoped share URL and that opening it renders the same messages in web.
- Validate end-to-end that Slack-originated user messages show italic "sent with Slack" in the web UI.
- Validate that a completed workflow edits the pending Slack bot message rather than posting a duplicate final response.
- Run `bun run --cwd apps/web db:generate` after schema changes.
- Run focused tests for the touched Slack/chat modules.
- Run `bun run ci` before shipping.

Decisions confirmed:
- Use the existing public chat share URL (`/shared/[shareId]`) as the Slack-to-web link.
- If the first Slack mention comes from an unlinked user, store the pending mention and automatically resume it after account linking completes.
- Only the linked thread owner can continue the mapped Slack thread; other Slack users should not write into that owned session.
