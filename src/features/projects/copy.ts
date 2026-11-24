import type { ProjectAnalysisSummary } from "@/features/projects/schemas";

/**
 * exact (design.md, Phase 2d, D-36): recommendation count text shown after
 * the status label of a project analysis history row, or null for no text.
 */
export function historyCountText(
  analysis: Pick<ProjectAnalysisSummary, "recommendationCount" | "errorCode">,
): string | null {
  const count = analysis.recommendationCount;
  if (count !== null) {
    if (count === 0) return "No recommendations";
    return count === 1 ? "1 recommendation" : `${count} recommendations`;
  }
  if (analysis.errorCode === "AI_DISABLED") return "AI analysis not enabled";
  if (analysis.errorCode === "AI_UNAVAILABLE") return "AI service did not respond";
  return null;
}
