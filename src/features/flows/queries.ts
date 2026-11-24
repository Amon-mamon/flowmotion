"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/features/api/client";
import { envelopeSchema } from "@/features/api/schemas";
import {
  flowDetailSchema,
  flowsResponseSchema,
  generateBodySchema,
  generateResponseSchema,
  type FlowStatus,
} from "@/features/flows/schemas";

export const flowKeys = {
  list: () => ["flows"] as const,
  detail: (flowId: string) => ["flows", flowId] as const,
};

/** Poll interval while a flow is `generating` (design.md "Flow page"). */
export const FLOW_POLL_MS = 2000;

/** Interval for TanStack `refetchInterval`: poll while generating, stop on `ready` / `failed`. */
export function flowRefetchInterval(
  status: FlowStatus | undefined,
  intervalMs: number = FLOW_POLL_MS,
): number | false {
  return status === "generating" ? intervalMs : false;
}

const id = (value: string) => encodeURIComponent(value);

/** `GET /api/flows/:id`, polling every 2 s while `generating`. */
export function useFlow(flowId: string, options: { pollIntervalMs?: number } = {}) {
  const intervalMs = options.pollIntervalMs ?? FLOW_POLL_MS;
  return useQuery({
    queryKey: flowKeys.detail(flowId),
    queryFn: ({ signal }) => apiFetch(`/api/flows/${id(flowId)}`, flowDetailSchema, { signal }),
    refetchInterval: (query) => flowRefetchInterval(query.state.data?.status, intervalMs),
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/flows` → the user's flows, newest first (at most 20). */
export function useFlows() {
  return useQuery({
    queryKey: flowKeys.list(),
    queryFn: ({ signal }) => apiFetch("/api/flows", flowsResponseSchema, { signal }),
    select: (data) => data.flows,
  });
}

export type GenerateInput = { recommendationId: string; allowStale?: boolean };

/**
 * `POST /api/recommendations/generate` → `{ flowIds }` (HTTP 202). The UI sends
 * one recommendation id per request (D-42).
 */
export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, allowStale }: GenerateInput) =>
      apiFetch("/api/recommendations/generate", generateResponseSchema, {
        method: "POST",
        body: generateBodySchema.parse({
          recommendationIds: [recommendationId],
          ...(allowStale ? { allowStale: true } : {}),
        }),
      }),
    // A new flow changes the card state and the flows list; an error such as
    // "A flow already exists" means the cached cards are out of date.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: flowKeys.list() }),
        queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] === "projects" && query.queryKey[2] === "recommendations",
        }),
      ]),
  });
}

const FALLBACK_FILENAME = "flow.n8n.json";

/** File name from `Content-Disposition`; only the slug shape the API promises is accepted. */
export function exportFilename(contentDisposition: string | null): string {
  const match = /filename="([a-z0-9-]{1,60}\.n8n\.json)"/.exec(contentDisposition ?? "");
  return match?.[1] ?? FALLBACK_FILENAME;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * `GET /api/flows/:id/export`: on success the body is the n8n JSON file (not
 * the envelope), saved through a blob so an error can be shown inline.
 */
export async function downloadFlowExport(flowId: string): Promise<{ filename: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/flows/${id(flowId)}/export`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0);
  }

  if (!response.ok) {
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      // Not JSON: handled as an unexpected response below.
    }
    const envelope = envelopeSchema.safeParse(json);
    if (envelope.success && !envelope.data.ok) {
      throw new ApiError(envelope.data.error.code, envelope.data.error.message, response.status);
    }
    throw new ApiError("INTERNAL", "The server returned an unexpected response.", response.status);
  }

  const blob = await response.blob();
  const filename = exportFilename(response.headers.get("Content-Disposition"));
  saveBlob(blob, filename);
  return { filename };
}
