import type { z } from "zod";

import { envelopeSchema } from "@/features/api/schemas";

/** Thrown for every failed request: transport, envelope, or API error. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type ApiRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Fetch wrapper for `/api/*`: sends JSON, unwraps the
 * `{ ok, data } | { ok, error }` envelope, validates `data` with the given
 * schema, and throws `ApiError` on any failure.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  request: ApiRequest = {},
): Promise<T> {
  const method = request.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("INTERNAL", "The server returned an unexpected response.", response.status);
  }

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new ApiError("INTERNAL", "The server returned an unexpected response.", response.status);
  }
  if (!envelope.data.ok) {
    throw new ApiError(envelope.data.error.code, envelope.data.error.message, response.status);
  }

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server response did not match the expected shape.",
      response.status,
    );
  }
  return parsed.data;
}

/** Short, generic user-facing message for an error (docs/design.md mapping). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "UNAUTHORIZED":
        return "Your session has expired.";
      case "RATE_LIMITED":
        return "Too many requests, try again in a minute";
      case "NOT_FOUND":
        return "Not found.";
      case "NETWORK":
        return error.message;
      case "VALIDATION_ERROR":
        return error.message || "Invalid input.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return "Something went wrong. Try again.";
}
