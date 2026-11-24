import type { Metadata } from "next";

import { FlowView } from "@/features/flows/components/flow-view";

export const metadata: Metadata = { title: "Flow" };

export default async function FlowPage({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params;
  return <FlowView flowId={flowId} />;
}
