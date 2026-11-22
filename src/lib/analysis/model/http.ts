/** Shared fetch helpers for the model adapters (runtime-neutral). */

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
