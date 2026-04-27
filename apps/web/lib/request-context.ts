import { nanoid } from "nanoid";

/**
 * Structured request logging with request context.
 *
 * Wraps route handlers to produce JSON-to-stdout logs with request ID,
 * tenant/user context, timing, and status. The request ID is also set
 * as the `x-request-id` response header for correlation.
 */

export function generateRequestId(): string {
  return `req_${nanoid(16)}`;
}

interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  method: string;
  path: string;
}

function extractContext(req: Request): RequestContext {
  const requestId =
    req.headers.get("x-request-id") ?? generateRequestId();
  const tenantId = req.headers.get("x-tenant-id") ?? undefined;
  const userId = req.headers.get("x-user-id") ?? undefined;
  const url = new URL(req.url);

  return {
    requestId,
    tenantId,
    userId,
    method: req.method,
    path: url.pathname,
  };
}

type RouteHandler = (req: Request, ...args: unknown[]) => Promise<Response>;

/**
 * Wrap a route handler with structured JSON logging and request ID propagation.
 *
 * On success: logs `{ level: 'info', requestId, tenantId, userId, method, path, status, durationMs }`.
 * On error:   logs `{ level: 'error', requestId, tenantId, userId, method, path, error, stack, durationMs }`.
 * Always adds `x-request-id` response header.
 */
export function withRequestContext(handler: RouteHandler): RouteHandler {
  return async (req: Request): Promise<Response> => {
    const ctx = extractContext(req);
    const start = Date.now();

    try {
      const response = await handler(req);
      const durationMs = Date.now() - start;

      console.log(
        JSON.stringify({
          level: "info",
          requestId: ctx.requestId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          method: ctx.method,
          path: ctx.path,
          status: response.status,
          durationMs,
        }),
      );

      response.headers.set("x-request-id", ctx.requestId);
      return response;
    } catch (error) {
      const durationMs = Date.now() - start;
      const message =
        error instanceof Error ? error.message : String(error);
      const stack =
        error instanceof Error ? error.stack : undefined;

      console.log(
        JSON.stringify({
          level: "error",
          requestId: ctx.requestId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          method: ctx.method,
          path: ctx.path,
          error: message,
          stack,
          durationMs,
        }),
      );

      const errorResponse = Response.json(
        { error: "Internal Server Error" },
        { status: 500 },
      );
      errorResponse.headers.set("x-request-id", ctx.requestId);
      return errorResponse;
    }
  };
}
