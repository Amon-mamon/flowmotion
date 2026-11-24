"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useRef } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/features/api/client";
import { ExportPanel } from "@/features/flows/components/export-panel";
import { FlowCanvas } from "@/features/flows/components/flow-canvas";
import { NodeInspector } from "@/features/flows/components/node-inspector";
import { FLOW_COPY, compatibleText, flowFailedMessage } from "@/features/flows/copy";
import { useFlow } from "@/features/flows/queries";
import type { FlowDetail } from "@/features/flows/schemas";
import { useFlowCanvasStore } from "@/stores/flow-canvas";

type Props = { flowId: string; pollIntervalMs?: number };

const linkClass = "inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline";

const analysisHref = (flow: Pick<FlowDetail, "projectId" | "analysisId">) =>
  `/projects/${encodeURIComponent(flow.projectId)}/analysis/${encodeURIComponent(flow.analysisId)}`;

/** `/flows/[flowId]`: header, then the generating, failed, or ready state (design.md "Flow page"). */
export function FlowView({ flowId, pollIntervalMs }: Props) {
  const flow = useFlow(flowId, { pollIntervalMs });
  const queryClient = useQueryClient();
  const clearSelection = useFlowCanvasStore((state) => state.clearSelection);

  // The inspector selection belongs to one flow page.
  useEffect(() => {
    clearSelection();
    return clearSelection;
  }, [flowId, clearSelection]);

  // When polling reaches `ready` or `failed`, the recommendation card changes too.
  const status = flow.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before === "generating" && status !== undefined && status !== "generating") {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "projects" && query.queryKey[2] === "recommendations",
      });
    }
  }, [status, queryClient]);

  if (flow.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading flow" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      </div>
    );
  }

  if (flow.isError) {
    const code = flow.error instanceof ApiError ? flow.error.code : null;
    // Unknown, foreign, or malformed id → Next 404.
    if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") return notFound();
    return <ErrorState title="Could not load flow" error={flow.error} onRetry={() => void flow.refetch()} />;
  }

  return <FlowBody flow={flow.data} />;
}

function FlowHeader({ flow }: { flow: FlowDetail }) {
  const compatible = compatibleText(flow.n8nVersion);
  return (
    <header className="flex flex-col gap-3">
      <Link href={analysisHref(flow)} className={linkClass}>
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {FLOW_COPY.backToAnalysis}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{flow.name}</h1>
      {flow.description !== null ? (
        <p className="max-w-3xl text-sm text-muted-foreground" data-testid="flow-description">
          {flow.description}
        </p>
      ) : null}
      <p className="font-mono text-sm break-all" data-testid="flow-repo">
        {flow.repoFullName}
      </p>
      {flow.status === "ready" ? (
        <div className="flex flex-col gap-1" data-testid="flow-level">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge variant="outline" data-level="valid" className="rounded-lg border-primary text-primary">
              <CheckIcon aria-hidden="true" />
              {FLOW_COPY.validBadge}
            </Badge>
            <p className="text-sm">{FLOW_COPY.validSentence}</p>
          </div>
          {compatible !== null ? <p className="text-sm text-muted-foreground">{compatible}</p> : null}
        </div>
      ) : null}
    </header>
  );
}

function GeneratingState() {
  return (
    <div className="flex flex-col gap-4" data-flow-state="generating">
      <p role="status" className="text-sm">
        {FLOW_COPY.generating}
      </p>
      <div
        aria-hidden="true"
        className="relative h-[28rem] overflow-hidden rounded-xl border border-border bg-background"
        data-testid="canvas-skeleton"
      >
        <Skeleton className="absolute top-1/2 left-[8%] h-[72px] w-[22%] -translate-y-1/2 rounded-xl" />
        <Skeleton className="absolute top-[28%] left-[39%] h-[72px] w-[22%] rounded-xl" />
        <Skeleton className="absolute top-[58%] left-[39%] h-[72px] w-[22%] rounded-xl" />
        <Skeleton className="absolute top-1/2 left-[70%] h-[72px] w-[22%] -translate-y-1/2 rounded-xl" />
      </div>
    </div>
  );
}

function FailedState({ flow }: { flow: FlowDetail }) {
  return (
    <div
      role="alert"
      data-flow-state="failed"
      data-error-code={flow.errorCode ?? "UNKNOWN"}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-primary bg-card px-6 py-10 text-center"
    >
      <XCircleIcon aria-hidden="true" className="size-6 text-primary" />
      <p className="max-w-md text-base font-medium">{flowFailedMessage(flow.errorCode)}</p>
      <Link href={analysisHref(flow)} className={linkClass}>
        {FLOW_COPY.backToAnalysis}
      </Link>
    </div>
  );
}

function ReadyState({ flow }: { flow: FlowDetail }) {
  const selectedNodeKey = useFlowCanvasStore((state) => state.selectedNodeKey);
  const clearSelection = useFlowCanvasStore((state) => state.clearSelection);
  const selectedNode = flow.nodes.find((node) => node.key === selectedNodeKey) ?? null;

  return (
    <>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]" data-flow-state="ready">
        <FlowCanvas flow={flow} />
        <ExportPanel flow={flow} />
      </div>
      <NodeInspector node={selectedNode} onClose={clearSelection} />
    </>
  );
}

function FlowBody({ flow }: { flow: FlowDetail }) {
  return (
    <>
      <FlowHeader flow={flow} />
      {flow.status === "generating" ? (
        <GeneratingState />
      ) : flow.status === "failed" ? (
        <FailedState flow={flow} />
      ) : (
        <ReadyState flow={flow} />
      )}
    </>
  );
}
