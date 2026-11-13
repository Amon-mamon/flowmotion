"use client";

import { useRouter } from "next/navigation";

import { useAnalyze } from "@/features/analysis/queries";

/** Starts an analysis and navigates to its page on success. */
export function useStartAnalysis(projectId: string) {
  const router = useRouter();
  const analyze = useAnalyze(projectId);
  return {
    start: () =>
      analyze.mutate(undefined, {
        onSuccess: ({ analysisId }) =>
          router.push(
            `/projects/${encodeURIComponent(projectId)}/analysis/${encodeURIComponent(analysisId)}`,
          ),
      }),
    isPending: analyze.isPending,
    error: analyze.error,
    reset: analyze.reset,
  };
}
