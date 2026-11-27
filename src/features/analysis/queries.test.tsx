import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analysesByStatus,
  doneAnalysis,
  doneRecommendations,
  fixtureProjectId,
  queuedAnalysis,
  scanningAnalysis,
} from "@/features/analysis/fixtures";
import {
  RECOMMENDATIONS_POLL_MS,
  analysisRefetchInterval,
  recommendationsRefetchInterval,
  useAnalysis,
  useAnalyze,
  useRecommendations,
} from "@/features/analysis/queries";
import { ANALYSIS_STATUSES, type Analysis, type Recommendation } from "@/features/analysis/schemas";
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

describe("recommendationsRefetchInterval (OC-6)", () => {
  const withStatus = (...statuses: Recommendation["status"][]) => ({
    analysisId: doneAnalysis.id,
    recommendations: statuses.map((status, i) => ({ ...doneRecommendations[i % doneRecommendations.length]!, status })),
  });

  it("polls every 3 s by default", () => {
    expect(RECOMMENDATIONS_POLL_MS).toBe(3000);
  });

  it("does not poll without data", () => {
    expect(recommendationsRefetchInterval(undefined)).toBe(false);
  });

  it("does not poll for an empty list", () => {
    expect(recommendationsRefetchInterval({ analysisId: null, recommendations: [] })).toBe(false);
  });

  it("polls while one recommendation is selected", () => {
    expect(recommendationsRefetchInterval(withStatus("new", "selected", "generated"))).toBe(3000);
    expect(recommendationsRefetchInterval(withStatus("selected"), 50)).toBe(50);
  });

  it("does not poll when only new or generated", () => {
    expect(recommendationsRefetchInterval(withStatus("new", "generated", "new"))).toBe(false);
  });
});

describe("useRecommendations polling (OC-6)", () => {
  afterEach(() => vi.useRealTimers());

  it("refetches after 3 s while a card is selected and stops once none is", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const first = doneRecommendations[0]!;
    const responses = [
      { analysisId: doneAnalysis.id, recommendations: [{ ...first, status: "selected" as const }] },
      { analysisId: doneAnalysis.id, recommendations: [{ ...first, status: "generated" as const }] },
    ];
    let calls = 0;
    const url = `/api/projects/${fixtureProjectId}/recommendations?analysisId=${doneAnalysis.id}`;
    const fetchMock = mockFetch([
      { match: (u) => u === url, respond: () => ok(responses[Math.min(calls++, responses.length - 1)]) },
    ]);

    const { result } = renderHook(() => useRecommendations(fixtureProjectId, doneAnalysis.id, true), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await vi.waitFor(() => expect(result.current.data?.recommendations[0]?.status).toBe("selected"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2900);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await vi.waitFor(() => expect(result.current.data?.recommendations[0]?.status).toBe("generated"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
