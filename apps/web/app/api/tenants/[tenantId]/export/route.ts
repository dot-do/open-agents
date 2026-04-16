import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { RbacError, requireRole } from "@/lib/rbac";
import { exportTenant } from "@/lib/tenant-export";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Response> {
  try {
    const { tenantId } = await params;
    const ctx = await requireTenantCtx(req);
    if (ctx.tenantId !== tenantId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requireRole(ctx, "owner");

    const [tenant] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await audit(ctx, "tenant.exported", {
      target: tenantId,
      metadata: { slug: tenant.slug },
    });

    const stream = await exportTenant(ctx);
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `tenant-${tenant.slug}-${iso}.ndjson`;

    // Bridge Node Readable -> Web ReadableStream for the Response body.
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        stream.on("data", (chunk: string | Buffer) => {
          controller.enqueue(
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          );
        });
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
