import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  memberships,
  tenantInvites,
  tenants,
  users,
} from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import { requireRole, type Role } from "@/lib/rbac";

const DEFAULT_EXPIRY_DAYS = 7;

export type CreateInviteInput = {
  email: string;
  role: Role;
};

export type InviteListRow = {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date;
  invitedByUserId: string;
};

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function acceptUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/invite/${token}`;
}

async function safeAudit(
  ctx: Pick<TenantContext, "tenantId" | "userId">,
  action: string,
  opts?: { target?: string; metadata?: unknown },
): Promise<void> {
  try {
    const mod = await import("@/lib/audit").catch(() => null);
    if (mod && typeof mod.audit === "function") {
      await mod.audit(ctx, action, opts);
    }
  } catch {
    // audit is best-effort; a parallel agent owns that module.
  }
}

async function sendInviteEmail(args: {
  email: string;
  tenantName: string;
  inviterEmail: string | null;
  token: string;
}): Promise<void> {
  const url = acceptUrl(args.token);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "invite.email_dev",
        to: args.email,
        tenant: args.tenantName,
        acceptUrl: url,
      }),
    );
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from:
          process.env.INVITE_FROM_EMAIL ?? "Open Agents <noreply@openagents.dev>",
        to: [args.email],
        subject: `You're invited to join ${args.tenantName} on Open Agents`,
        html: `<p>You've been invited to join <strong>${escapeHtml(args.tenantName)}</strong>${
          args.inviterEmail ? ` by ${escapeHtml(args.inviterEmail)}` : ""
        }.</p><p><a href="${url}">Accept invite</a></p><p>This link expires in ${DEFAULT_EXPIRY_DAYS} days.</p>`,
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "invite.email_failed",
          status: res.status,
          to: args.email,
        }),
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "invite.email_failed",
        to: args.email,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}

export async function createInvite(
  ctx: TenantContext,
  input: CreateInviteInput,
): Promise<{ id: string; token: string; acceptUrl: string }> {
  requireRole(ctx, "admin");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("invalid email");
  }
  // owner-only can invite another owner
  if (input.role === "owner" && ctx.role !== "owner") {
    throw new Error("only owners can invite owners");
  }

  const id = nanoid();
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.insert(tenantInvites).values({
    id,
    tenantId: ctx.tenantId,
    email,
    role: input.role,
    token,
    invitedByUserId: ctx.userId,
    createdAt: now,
    expiresAt,
  });

  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);
  const [inviter] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  await sendInviteEmail({
    email,
    tenantName: tenantRow?.name ?? "your team",
    inviterEmail: inviter?.email ?? null,
    token,
  });

  await safeAudit(ctx, "member.invited", {
    target: id,
    metadata: { email, role: input.role },
  });

  return { id, token, acceptUrl: acceptUrl(token) };
}

export async function listInvites(
  ctx: TenantContext,
): Promise<InviteListRow[]> {
  requireRole(ctx, "admin");
  const now = new Date();
  const rows = await db
    .select({
      id: tenantInvites.id,
      email: tenantInvites.email,
      role: tenantInvites.role,
      createdAt: tenantInvites.createdAt,
      expiresAt: tenantInvites.expiresAt,
      invitedByUserId: tenantInvites.invitedByUserId,
    })
    .from(tenantInvites)
    .where(
      and(
        eq(tenantInvites.tenantId, ctx.tenantId),
        isNull(tenantInvites.acceptedAt),
        gt(tenantInvites.expiresAt, now),
      ),
    )
    .orderBy(desc(tenantInvites.createdAt));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as Role,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    invitedByUserId: r.invitedByUserId,
  }));
}

export async function revokeInvite(
  ctx: TenantContext,
  id: string,
): Promise<void> {
  requireRole(ctx, "admin");
  const [row] = await db
    .select({ id: tenantInvites.id, tenantId: tenantInvites.tenantId })
    .from(tenantInvites)
    .where(eq(tenantInvites.id, id))
    .limit(1);
  if (!row || row.tenantId !== ctx.tenantId) {
    throw new Error("invite not found");
  }
  await db.delete(tenantInvites).where(eq(tenantInvites.id, id));
  await safeAudit(ctx, "member.invite_revoked", { target: id });
}

export type AcceptInviteResult = {
  tenantId: string;
  tenantSlug: string;
  role: Role;
  emailMismatch: boolean;
};

export async function acceptInvite(args: {
  token: string;
  userId: string;
}): Promise<AcceptInviteResult> {
  const { token, userId } = args;
  const [invite] = await db
    .select()
    .from(tenantInvites)
    .where(eq(tenantInvites.token, token))
    .limit(1);
  if (!invite) throw new Error("invite not found");
  if (invite.acceptedAt) throw new Error("invite already accepted");
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new Error("invite expired");
  }

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const emailMismatch = Boolean(
    user?.email && user.email.toLowerCase() !== invite.email.toLowerCase(),
  );

  // Insert membership (idempotent if already present).
  const existing = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, invite.tenantId),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    await db.insert(memberships).values({
      tenantId: invite.tenantId,
      userId,
      role: invite.role,
    });
  }

  await db
    .update(tenantInvites)
    .set({ acceptedAt: new Date(), acceptedByUserId: userId })
    .where(eq(tenantInvites.id, invite.id));

  const [tenantRow] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, invite.tenantId))
    .limit(1);

  const ctx = {
    tenantId: invite.tenantId,
    userId,
    role: invite.role as Role,
  };
  if (emailMismatch) {
    await safeAudit(ctx, "invite.email_mismatch", {
      target: invite.id,
      metadata: {
        inviteEmail: invite.email,
        userEmail: user?.email ?? null,
      },
    });
  }
  await safeAudit(ctx, "member.joined", {
    target: invite.id,
    metadata: { role: invite.role, email: invite.email },
  });

  return {
    tenantId: invite.tenantId,
    tenantSlug: tenantRow?.slug ?? "",
    role: invite.role as Role,
    emailMismatch,
  };
}
