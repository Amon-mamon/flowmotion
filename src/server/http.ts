import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { logServerError } from "@/server/log";
import { ERROR_STATUS, type ApiFailure, type ApiSuccess, type ErrorCode } from "@/schemas/api";

/**
 * HTTP helpers for route handlers (docs/contract.md section 6).
 * Every response is the envelope `{ ok: true, data } | { ok: false, error }`.
 */

/** Thrown anywhere in a handler; `withApi` turns it into the envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string, status?: number) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = status ?? ERROR_STATUS[code];
  }
}

export const DEFAULT_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  UNAUTHORIZED: "You must be signed in.",
  FORBIDDEN: "This request is not allowed.",
  NOT_FOUND: "Not found.",
  VALIDATION_ERROR: "The request is invalid.",
  RATE_LIMITED: "Too many requests. Please try again in a minute.",
  DAILY_CAP_REACHED: "Daily limit reached.",
  PROJECT_STALE_ANALYSIS: "The analysis is older than the repository's latest commit.",
  EXPORT_NOT_VALID: "This flow is not valid for export yet.",
  INTERNAL: "Something went wrong. Please try again.",
};

/** Success envelope. */
export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true as const, data }, { status });
}

/** Failure envelope with the contract's status for the code unless overridden. */
export function fail(
  code: ErrorCode,
  message: string = DEFAULT_MESSAGES[code],
  status: number = ERROR_STATUS[code],
): NextResponse<ApiFailure> {
  return NextResponse.json({ ok: false as const, error: { code, message } }, { status });
}

/** Envelope for an ApiError instance. */
export function failFrom(error: ApiError): NextResponse<ApiFailure> {
  return fail(error.code, error.message, error.status);
}

/** First issue of a Zod error as a short, user-safe message. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return DEFAULT_MESSAGES.VALIDATION_ERROR;
  const path = issue.path.map(String).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

/** Parses a JSON body with Zod. Invalid JSON or shape → VALIDATION_ERROR 400. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be JSON.");
  }
  return parseWith(schema, raw);
}

/** Parses URL search params with Zod. */
export function parseQuery<T extends z.ZodType>(url: string | URL, schema: T): z.infer<T> {
  const params = new URL(url).searchParams;
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in record)) record[key] = value;
  }
  return parseWith(schema, record);
}

/** Parses an unknown value with Zod, mapping failures to VALIDATION_ERROR. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION_ERROR", zodMessage(result.error));
  return result.data;
}

/** Parses route params; a malformed id is NOT_FOUND, not a validation error. */
export function parseParams<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("NOT_FOUND");
  return result.data;
}

/** Methods that must pass the CSRF Origin check. */
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * CSRF guard (docs/security.md section 5): a state-changing request whose
 * `Origin` header is present and differs from the APP_URL origin is refused.
 * Requests without an Origin header (same-origin fetches in some browsers,
 * server-to-server) are allowed; cookies are sameSite so the risk is bounded.
 */
export function isOriginAllowed(
  originHeader: string | null | undefined,
  appUrl: string,
): boolean {
  if (originHeader === null || originHeader === undefined || originHeader === "") return true;
  let origin: URL;
  let app: URL;
  try {
    origin = new URL(originHeader);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  return origin.origin === app.origin;
}

export function assertOriginAllowed(request: Request, appUrl: string): void {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return;
  if (!isOriginAllowed(request.headers.get("origin"), appUrl)) {
    throw new ApiError("FORBIDDEN", "Cross-origin request refused.");
  }
}

/** Client IP for per-IP rate limits (first X-Forwarded-For entry on Vercel). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real !== null && real.trim() !== "") return real.trim();
  return "unknown";
}

/** Route context shape for dynamic segments in Next.js 16 (params are async). */
export interface RouteContext<P extends Record<string, string> = Record<string, string>> {
  params: Promise<P>;
}

export type ApiHandler<P extends Record<string, string> = Record<string, string>> = (
  request: Request,
  context: RouteContext<P>,
) => Promise<Response>;

/**
 * Wraps a handler: ApiError → its envelope, any other error → INTERNAL 500
 * with a generic message. Errors are logged by name and code only.
 */
export function withApi<P extends Record<string, string> = Record<string, string>>(
  name: string,
  handler: ApiHandler<P>,
): ApiHandler<P> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "INTERNAL") logServerError(name, error);
        return failFrom(error);
      }
      logServerError(name, error);
      return fail("INTERNAL");
    }
  };
}
