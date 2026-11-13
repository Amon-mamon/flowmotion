import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { analysesByStatus, queuedAnalysis, scanningAnalysis } from "@/features/analysis/fixtures";
import { analysisRefetchInterval, useAnalysis, useAnalyze } from "@/features/analysis/queries";
import { ANALYSIS_STATUSES, type Analysis } from "@/features/analysis/schemas";
import { fail, mockFetch, ok } from "@/features/test-utils/render";

afterEach(() => vi.unstubAllGlobals());

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("analysisRefetchInterval", () => {
  it.each(ANALYSIS_STATUSES)("%s", (status) => {
    const active = ["queued", "validating", "scanning", "analyzing"].includes(status);
    expect(analysisRefetchInterval(status)).toBe(active ? 2000 : false);
  });

  it("does not poll before the first response", () => {
    expect(analysisRefetchInterval(undefined)).toBe(false);
  });
});

describe("useAnalysis polling", () => {
  it.each(["done", "failed", "rejected"] as const)("polls while active and stops at %s", async (terminal) => {
    const final: Analysis = { ...analysesByStatus[terminal], id: queuedAnalysis.id };
    const sequence: Analysis[] = [queuedAnalysis, { ...scanningAnalysis, id: queuedAnalysis.id }, final];
    let calls = 0;
    const fetchMock = mockFetch([
      {
        match: (u) => u === `/api/analyses/${queuedAnalysis.id}`,
        respond: () => ok(sequence[Math.min(calls++, sequence.length - 1)]),
      },
    ]);

    const { result } = renderHook(() => useAnalysis(queuedAnalysis.id, { pollIntervalMs: 10 }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data?.status).toBe(terminal));
    const callsAtTerminal = fetchMock.mock.calls.length;
    expect(callsAtTerminal).toBe(3);
    await sleep(80);
    expect(fetchMock.mock.calls.length).toBe(callsAtTerminal);
  });

  it("does not poll after an error", async () => {
    const fetchMock = mockFetch([{ match: () => true, respond: () => fail("INTERNAL", "x", 500) }]);
    const { result } = renderHook(() => useAnalysis(queuedAnalysis.id, { pollIntervalMs: 10 }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await sleep(60);
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

describe("useAnalyze", () => {
  it("POSTs with no body and returns the analysis id", async () => {
    const fetchMock = mockFetch([
      {
        method: "POST",
        match: (u) => u === "/api/projects/p1/analyze",
        respond: () => ok({ analysisId: queuedAnalysis.id }, 202),
      },
    ]);
    const { result } = renderHook(() => useAnalyze("p1"), { wrapper: wrapper() });
    result.current.mutate();
    await waitFor(() => expect(result.current.data).toEqual({ analysisId: queuedAnalysis.id }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });
});
