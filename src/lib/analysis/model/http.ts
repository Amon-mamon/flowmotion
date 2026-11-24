/** Shared fetch helpers for the model adapters (runtime-neutral). */

import { ModelProviderError } from "@/lib/analysis/model/types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 408, 429 and 5xx are retryable; every other non-2xx is not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** A signal that aborts on the timeout or on the caller's signal, whichever comes first. */
export function combineSignals(timeoutMs: number, outer: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (outer === undefined) return timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (timeout.aborted || outer.aborted) controller.abort();
  timeout.addEventListener("abort", abort, { once: true });
  outer.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

/**
 * POSTs to the provider and returns the parsed JSON body of a 2xx response.
 * Maps every failure to a `ModelProviderError` with a fixed reason (D-35):
 * fetch rejects → `timeout` when the signal is aborted (own timer or caller),
 * else `network`; non-2xx → `http` (retryable for 408/429/5xx); the body is
 * not JSON → `timeout` when aborted, else `not_json`. Bodies are never read
 * into an error.
 */
export async function postModelJson(
  doFetch: FetchLike,
  url: string,
  init: Omit<RequestInit, "signal">,
  signal: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal });
  } catch {
    throw new ModelProviderError(signal.aborted ? "timeout" : "network", null, true);
  }
  if (!response.ok) {
    throw new ModelProviderError("http", response.status, isRetryableStatus(response.status));
  }
  try {
    return { status: response.status, json: (await response.json()) as unknown };
  } catch {
    throw new ModelProviderError(signal.aborted ? "timeout" : "not_json", response.status, true);
  }
}
