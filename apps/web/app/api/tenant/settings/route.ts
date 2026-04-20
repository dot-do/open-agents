import { NextResponse, type NextRequest } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { RbacError, requireRole } from "@/lib/rbac";

/**
 * GET /api/tenant/settings — return current tenant info (name, slug, description).
 */
export async function GET(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

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
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 1-100 characters." },
        { status: 400 },
      );
    }
    updates.name = name;
  }

  if ("slug" in body) {
    const slug = String(body.slug ?? "")
      .trim()
      .toLowerCase();
    if (slug.length < 3 || slug.length > 50) {
      return NextResponse.json(
        { error: "Slug must be 3-50 characters." },
        { status: 400 },
      );
    }
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "Slug must be alphanumeric with dashes, no leading/trailing dash." },
        { status: 400 },
      );
    }

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

  if ("description" in body) {
    const description = body.description == null ? null : String(body.description).trim();
    if (description && description.length > 500) {
      return NextResponse.json(
        { error: "Description must be at most 500 characters." },
        { status: 400 },
      );
    }
    updates.description = description;
  }

  if ("logoUrl" in body) {
    const logoUrl = body.logoUrl == null ? null : String(body.logoUrl).trim();
    if (logoUrl && logoUrl.length > 2048) {
      return NextResponse.json(
        { error: "Logo URL must be at most 2048 characters." },
        { status: 400 },
      );
    }
    updates.logoUrl = logoUrl;
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
