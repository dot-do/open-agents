import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { notificationPreferences } from "@/lib/db/schema";

export type NotificationChannel = "email" | "none";

/**
 * Events that default to sending notifications when no explicit preference
 * exists. Absence of a row = opt-in to email.
 */
export const DEFAULT_NOTIFICATION_EVENTS = [
  "quota.warning",
  "quota.halted",
  "session.completed",
  "member.joined",
  "member.invited",
] as const;

export type NotificationEvent = (typeof DEFAULT_NOTIFICATION_EVENTS)[number];

/**
 * Human-readable labels for notification events.
 */
export const EVENT_LABELS: Record<string, string> = {
  "quota.warning": "Quota warning (approaching limit)",
  "quota.halted": "Quota halted (limit reached)",
  "session.completed": "Session completed",
  "member.joined": "Member joined workspace",
  "member.invited": "Member invited to workspace",
};

/**
 * Get all notification preferences for a user within a tenant.
 * Returns a map of event -> channel. Events without explicit prefs
 * are not included (callers should treat absence as 'email').
 */
export async function getPrefs(
  tenantId: string,
  userId: string,
): Promise<Record<string, NotificationChannel>> {
  const rows = await db
    .select({
      event: notificationPreferences.event,
      channel: notificationPreferences.channel,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, userId),
      ),
    );

  const map: Record<string, NotificationChannel> = {};
  for (const row of rows) {
    map[row.event] = row.channel as NotificationChannel;
  }
  return map;
}

/**
 * Upsert a single notification preference.
 */
export async function updatePref(
  tenantId: string,
  userId: string,
  event: string,
  channel: NotificationChannel,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      id: nanoid(),
      tenantId,
      userId,
      event,
      channel,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.tenantId,
        notificationPreferences.userId,
        notificationPreferences.event,
      ],
      set: {
        channel,
        updatedAt: new Date(),
      },
    });
}

/**
 * Check if a notification should be sent for a given event.
 * Default opt-in: returns true if no preference exists or if channel is 'email'.
 * Returns false only when explicitly set to 'none'.
 */
export async function shouldNotify(
  tenantId: string,
  userId: string,
  event: string,
): Promise<boolean> {
  const rows = await db
    .select({ channel: notificationPreferences.channel })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.event, event),
      ),
    )
    .limit(1);

  if (rows.length === 0) return true; // default opt-in
  return rows[0].channel !== "none";
}
