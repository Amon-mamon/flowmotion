import type { Metadata } from "next";

import { AnalysisView } from "@/features/analysis/components/analysis-view";

export const metadata: Metadata = { title: "Analysis" };

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ projectId: string; analysisId: string }>;
}) {
  const { projectId, analysisId } = await params;
  return <AnalysisView projectId={projectId} analysisId={analysisId} />;
}
