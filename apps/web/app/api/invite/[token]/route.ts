import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { tenantInvites, tenants } from "@/lib/db/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const [invite] = await db
    .select({
      id: tenantInvites.id,
      tenantId: tenantInvites.tenantId,
      email: tenantInvites.email,
      role: tenantInvites.role,
      expiresAt: tenantInvites.expiresAt,
      acceptedAt: tenantInvites.acceptedAt,
    })
    .from(tenantInvites)
    .where(eq(tenantInvites.token, token))
    .limit(1);
  if (!invite) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const expired = invite.expiresAt.getTime() < Date.now();
  const accepted = Boolean(invite.acceptedAt);
  const [tenantRow] = await db
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, invite.tenantId))
    .limit(1);
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    tenantName: tenantRow?.name ?? null,
    tenantSlug: tenantRow?.slug ?? null,
    expired,
    accepted,
  });
}
