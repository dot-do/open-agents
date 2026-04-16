import "server-only";

/**
 * Minimal Resend-backed transactional email helper.
 *
 * Uses Resend's HTTPS API directly via `fetch` so we don't need to take a
 * runtime dependency on the Resend SDK. When `RESEND_API_KEY` is unset
 * (local dev, CI), we emit a structured `email.dev` log line instead of
 * making a network call — this lets feature code use the same code path
 * everywhere without environment-specific branches.
 */

export type SendEmailArgs = {
  to: string | readonly string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Optional override for the From: header. Defaults to
   * `EMAIL_FROM` env var, then `INVITE_FROM_EMAIL` for back-compat with
   * the legacy invite-only setup, then a sensible no-reply fallback.
   */
  from?: string;
  /** Optional structured-log event tag; defaults to "email". */
  event?: string;
};

export type SendEmailResult = {
  ok: boolean;
  /** Provider-side message id when available. */
  id?: string;
  /** HTTP status from the provider, or undefined when no request was made. */
  status?: number;
  /** Error message when ok=false. */
  error?: string;
  /** True when no API key was configured and we logged instead of sending. */
  dev?: boolean;
};

function defaultFrom(): string {
  return (
    process.env.EMAIL_FROM ??
    process.env.INVITE_FROM_EMAIL ??
    "Open Agents <noreply@openagents.dev>"
  );
}

function toRecipients(to: string | readonly string[]): string[] {
  return Array.isArray(to) ? [...to] : [to as string];
}

/**
 * Send a transactional email. Never throws — failures are returned as
 * `{ ok: false }` and logged structurally so callers can decide whether
 * the failure is fatal for their flow.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const recipients = toRecipients(args.to);
  const event = args.event ?? "email";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "email.dev",
        kind: event,
        to: recipients,
        subject: args.subject,
      }),
    );
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: args.from ?? defaultFrom(),
        to: recipients,
        subject: args.subject,
        html: args.html,
        ...(args.text ? { text: args.text } : {}),
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: `${event}.failed`,
          status: res.status,
          to: recipients,
        }),
      );
      return { ok: false, status: res.status };
    }
    let id: string | undefined;
    try {
      const body = (await res.json()) as { id?: string } | null;
      id = body?.id;
    } catch {
      // Provider returned a non-JSON 2xx; that's still a success.
    }
    return { ok: true, status: res.status, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: `${event}.failed`,
        to: recipients,
        error: message,
      }),
    );
    return { ok: false, error: message };
  }
}

/**
 * Minimal HTML escape for interpolating user-controlled strings into
 * email bodies. Not a full sanitizer — only safe for text content, not
 * for attribute values that might end up unquoted.
 */
export function escapeHtml(s: string): string {
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
