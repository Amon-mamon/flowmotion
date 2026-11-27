"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/features/api/client";
import {
  analysisSchema,
  analyzeResponseSchema,
  findingsResponseSchema,
  isActiveStatus,
  recommendationsResponseSchema,
  type AnalysisStatus,
  type RecommendationsResponse,
} from "@/features/analysis/schemas";
import { projectKeys } from "@/features/projects/queries";

export const analysisKeys = {
  detail: (analysisId: string) => ["analyses", analysisId] as const,
  findings: (projectId: string, analysisId: string) =>
    ["projects", projectId, "findings", analysisId] as const,
  recommendations: (projectId: string, analysisId: string) =>
    ["projects", projectId, "recommendations", analysisId] as const,
};

/** Poll interval while an analysis is `queued`..`analyzing` (contract Phase 2 scope). */
export const ANALYSIS_POLL_MS = 2000;

/** Interval for TanStack `refetchInterval`: poll while active, stop on a terminal status. */
export function analysisRefetchInterval(
  status: AnalysisStatus | undefined,
  intervalMs: number = ANALYSIS_POLL_MS,
): number | false {
  return status !== undefined && isActiveStatus(status) ? intervalMs : false;
}

/** Poll interval while any recommendation has a flow `generating` (Phase 3b, OC-6). */
export const RECOMMENDATIONS_POLL_MS = 3000;

/** Interval for TanStack `refetchInterval`: poll while a card is `selected`, else stop. */
export function recommendationsRefetchInterval(
  data: RecommendationsResponse | undefined,
  intervalMs: number = RECOMMENDATIONS_POLL_MS,
): number | false {
  return data?.recommendations.some((rec) => rec.status === "selected") ? intervalMs : false;
}

const id = (value: string) => encodeURIComponent(value);

/** `POST /api/projects/:id/analyze` → `{ analysisId }` (HTTP 202). */
export function useAnalyze(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${id(projectId)}/analyze`, analyzeResponseSchema, { method: "POST" }),
    // Success adds an analysis; an error such as "An analysis is already
    // running" means the cached project is out of date. Refresh either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
  });
}

/**
 * `GET /api/analyses/:id`, polling every 2 s while the status is active and
 * stopping on `done`, `failed`, or `rejected`.
 */
export function useAnalysis(analysisId: string, options: { pollIntervalMs?: number } = {}) {
  const intervalMs = options.pollIntervalMs ?? ANALYSIS_POLL_MS;
  return useQuery({
    queryKey: analysisKeys.detail(analysisId),
    queryFn: ({ signal }) => apiFetch(`/api/analyses/${id(analysisId)}`, analysisSchema, { signal }),
    refetchInterval: (query) => analysisRefetchInterval(query.state.data?.status, intervalMs),
    refetchIntervalInBackground: false,
  });
}

/** `GET /api/projects/:id/findings?analysisId=` once the analysis is `done` or `failed`. */
export function useFindings(projectId: string, analysisId: string, enabled: boolean) {
  return useQuery({
    queryKey: analysisKeys.findings(projectId, analysisId),
    queryFn: ({ signal }) =>
      apiFetch(
        `/api/projects/${id(projectId)}/findings?analysisId=${id(analysisId)}`,
        findingsResponseSchema,
        { signal },
      ),
    enabled,
  });
}

/**
 * `GET /api/projects/:id/recommendations?analysisId=` once the analysis is
 * `done` or `failed`; refetches every 3 s while a flow is generating.
 */
export function useRecommendations(projectId: string, analysisId: string, enabled: boolean) {
  return useQuery({
    queryKey: analysisKeys.recommendations(projectId, analysisId),
    queryFn: ({ signal }) =>
      apiFetch(
        `/api/projects/${id(projectId)}/recommendations?analysisId=${id(analysisId)}`,
        recommendationsResponseSchema,
        { signal },
      ),
    enabled,
    refetchInterval: (query) => recommendationsRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
}
