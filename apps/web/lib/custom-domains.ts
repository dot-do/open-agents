import "server-only";

import dns from "node:dns";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { tenantCustomDomains } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";

// ---------------------------------------------------------------------------
// Domain validation
// ---------------------------------------------------------------------------

const DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  // Strip protocol if someone pastes a URL
  d = d.replace(/^https?:\/\//, "");
  // Strip trailing path / slash
  d = d.replace(/\/.*$/, "");
  // Strip port
  d = d.replace(/:\d+$/, "");
  return d;
}

function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain) && domain.length <= 253;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Add a custom domain to the current tenant. Returns the domain record
 * including the verification token and the TXT record name the admin must
 * create in their DNS provider.
 */
export async function addDomain(
  ctx: TenantContext,
  rawDomain: string,
): Promise<{
  domain: string;
  verificationToken: string;
  txtRecord: string;
  id: string;
}> {
  const domain = normalizeDomain(rawDomain);
  if (!isValidDomain(domain)) {
    throw new Error(
      "Invalid domain format. Provide a bare domain like example.com (no protocol or path).",
    );
  }

  const id = `dom_${nanoid(21)}`;
  const verificationToken = nanoid(32);

  await db.insert(tenantCustomDomains).values({
    id,
    tenantId: ctx.tenantId,
    domain,
    verificationToken,
  });

  return {
    id,
    domain,
    verificationToken,
    txtRecord: `_open-agents-verify.${domain}`,
  };
}

/**
 * Verify a custom domain by looking up the expected DNS TXT record.
 * Uses Node's `dns.promises.resolveTxt` with a 10-second timeout.
 */
export async function verifyDomain(
  ctx: TenantContext,
  domainId: string,
): Promise<{ verified: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(tenantCustomDomains)
    .where(
      and(
        eq(tenantCustomDomains.id, domainId),
        eq(tenantCustomDomains.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("Domain not found");
  }

  if (row.verified) {
    return { verified: true };
  }

  const txtHost = `_open-agents-verify.${row.domain}`;

  try {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(["8.8.8.8", "1.1.1.1"]);

    // Race against a timeout so a hung DNS lookup doesn't block the request.
    const records = await Promise.race([
      resolver.resolveTxt(txtHost),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS lookup timed out")), 10_000),
      ),
    ]);

    // resolveTxt returns string[][] — each record is an array of chunks.
    const flat = records.flat();
    const match = flat.some((v) => v === row.verificationToken);

    if (match) {
      await db
        .update(tenantCustomDomains)
        .set({ verified: true, verifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantCustomDomains.id, domainId));
      return { verified: true };
    }

    return {
      verified: false,
      error: `TXT record for ${txtHost} does not contain the expected token. Found: ${flat.join(", ") || "(none)"}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ENOTFOUND / ENODATA are normal when the record hasn't propagated yet.
    if (msg.includes("ENOTFOUND") || msg.includes("ENODATA")) {
      return {
        verified: false,
        error: `No TXT record found at ${txtHost}. DNS changes can take up to 48 hours to propagate.`,
      };
    }
    return { verified: false, error: `DNS lookup failed: ${msg}` };
  }
}

/**
 * List all custom domains for the current tenant.
 */
export async function listDomains(ctx: TenantContext) {
  return db
    .select()
    .from(tenantCustomDomains)
    .where(eq(tenantCustomDomains.tenantId, ctx.tenantId))
    .orderBy(tenantCustomDomains.createdAt);
}

/**
 * Remove a custom domain. The caller must be admin+.
 */
export async function removeDomain(
  ctx: TenantContext,
  domainId: string,
): Promise<void> {
  const result = await db
    .delete(tenantCustomDomains)
    .where(
      and(
        eq(tenantCustomDomains.id, domainId),
        eq(tenantCustomDomains.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: tenantCustomDomains.id });

  if (result.length === 0) {
    throw new Error("Domain not found");
  }
}

/**
 * Look up a tenant by verified custom domain. Used for request routing
 * (Host header matching). Returns the tenantId if a verified domain exists.
 */
export async function lookupTenantByDomain(
  domain: string,
): Promise<string | null> {
  const normalized = normalizeDomain(domain);
  const [row] = await db
    .select({ tenantId: tenantCustomDomains.tenantId })
    .from(tenantCustomDomains)
    .where(
      and(
        eq(tenantCustomDomains.domain, normalized),
        eq(tenantCustomDomains.verified, true),
      ),
    )
    .limit(1);
  return row?.tenantId ?? null;
}
