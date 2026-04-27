import { NextResponse, type NextRequest } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError, tenantErrorResponse } from "@/lib/db/tenant-context";
import { RbacError, requireRole } from "@/lib/rbac";
import { validateBody } from "@/lib/validation";

/**
 * GET /api/tenant/settings — return current tenant info (name, slug, description).
 */
export async function GET(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (err) {
    if (err instanceof TenantAccessError) return tenantErrorResponse(err);
    throw err;
  }

  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      logoUrl: tenants.logoUrl,
      description: tenants.description,
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  return NextResponse.json({ tenant });
}

const settingsSchema = z.object({
  name: z.string().min(1).max(100).transform((s) => s.trim()).optional(),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be alphanumeric with dashes, no leading/trailing dash.").transform((s) => s.trim().toLowerCase()).optional(),
  description: z.string().max(500).transform((s) => s.trim()).nullable().optional(),
  logoUrl: z.string().max(2048).url().transform((s) => s.trim()).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "No valid fields to update." });

/**
 * PATCH /api/tenant/settings — update name, slug, description. Owner/admin only.
 * Slug: alphanumeric-dash, 3-50 chars, must be unique.
 */
export async function PATCH(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) return tenantErrorResponse(err);
    throw err;
  }

  const { data: body, response } = await validateBody(req, settingsSchema);
  if (response) return response;

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updates.name = body.name;
  }

  if (body.slug !== undefined) {
    const slug = body.slug;

    // Check uniqueness (exclude self).
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), ne(tenants.id, ctx.tenantId)))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Slug is already taken." },
        { status: 409 },
      );
    }

    updates.slug = slug;
  }

  if (body.description !== undefined) {
    updates.description = body.description;
  }

  if (body.logoUrl !== undefined) {
    updates.logoUrl = body.logoUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update." },
      { status: 400 },
    );
  }

  updates.updatedAt = new Date();

  const [updated] = await db
    .update(tenants)
    .set(updates)
    .where(eq(tenants.id, ctx.tenantId))
    .returning({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      logoUrl: tenants.logoUrl,
      description: tenants.description,
    });

  return NextResponse.json({ tenant: updated });
}
