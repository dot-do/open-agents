import { NextResponse, type NextRequest } from "next/server";
import type { ZodError, ZodSchema } from "zod";

/** Maximum request body size (bytes) accepted by POST/PATCH routes. */
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

/**
 * Returns a 413 response if the Content-Length header exceeds `MAX_BODY_BYTES`.
 * Should be called before `req.json()`.
 */
export function checkBodySize(req: NextRequest): Response | null {
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413 },
    );
  }
  return null;
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns `{ data }` on success, `{ response }` on failure (400/413).
 */
export async function validateBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): Promise<{ data: T; response?: never } | { data?: never; response: Response }> {
  const sizeErr = checkBodySize(req);
  if (sizeErr) return { response: sizeErr };

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      response: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      response: NextResponse.json(
        {
          error: "validation_error",
          details: (result.error as ZodError).issues,
        },
        { status: 400 },
      ),
    };
  }
  return { data: result.data };
}
