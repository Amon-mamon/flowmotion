"use client";

import { useRef, type ReactNode } from "react";

import { FlowLine } from "@/features/marketing/components/flow-line";
import { FlowStoreProvider } from "@/features/marketing/flow-store";
import { useMounted } from "@/features/marketing/hooks";

/**
 * One relative wrapper around Hero to Final CTA (contract M2). It holds the
 * decorative flow layer, rendered only after mount so the server HTML has no
 * decorative layer, and the store that tells section intros when their node
 * lights.
 */
export function FlowWrapper({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  return (
    <FlowStoreProvider>
      <div ref={wrapperRef} data-flow-wrapper="" className="relative isolate">
        {mounted ? <FlowLine wrapperRef={wrapperRef} /> : null}
        {children}
      </div>
    </FlowStoreProvider>
  );
}
