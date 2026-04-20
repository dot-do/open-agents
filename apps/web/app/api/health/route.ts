import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { isRedisConfigured, createRedisClient } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus: "ok" | "error" = "error";
  let redisStatus: "ok" | "error" | "not_configured" = "not_configured";

  // Check DB
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = "ok";
  } catch {
    dbStatus = "error";
  }

  // Check Redis
  if (isRedisConfigured()) {
    try {
      const client = createRedisClient("health-check");
      await client.ping();
      await client.quit();
      redisStatus = "ok";
    } catch {
      redisStatus = "error";
    }
  }

  const status =
    dbStatus === "error"
      ? "down"
      : redisStatus === "error"
        ? "degraded"
        : "ok";

  const body = {
    status,
    checks: { db: dbStatus, redis: redisStatus },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: status === "down" ? 503 : 200,
  });
}
