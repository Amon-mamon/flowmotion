import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/features/api/client";
import { failedFlows, flowId, flowSummaries, generatingFlow, readyFlow } from "@/features/flows/fixtures";
import {
  downloadFlowExport,
  exportFilename,
  flowRefetchInterval,
  useFlow,
  useFlows,
  useGenerate,
} from "@/features/flows/queries";
import { isGenerateApiReady } from "@/features/flows/readiness";
import { FLOW_STATUSES, type FlowDetail } from "@/features/flows/schemas";
import { fail, mockFetch, ok } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("flowRefetchInterval", () => {
  it.each(FLOW_STATUSES)("%s", (status) => {
    expect(flowRefetchInterval(status)).toBe(status === "generating" ? 2000 : false);
  });

  it("does not poll before the first response", () => {
    expect(flowRefetchInterval(undefined)).toBe(false);
  });
});

describe("useFlow polling", () => {
  const terminals: Record<"ready" | "failed", FlowDetail> = {
    ready: { ...readyFlow, id: generatingFlow.id },
    failed: { ...failedFlows.GENERATION_EXHAUSTED, id: generatingFlow.id },
  };

  it.each(["ready", "failed"] as const)("polls while generating and stops at %s", async (terminal) => {
    const sequence: FlowDetail[] = [generatingFlow, generatingFlow, terminals[terminal]];
    let calls = 0;
    const fetchMock = mockFetch([
      {
        match: (u) => u === `/api/flows/${generatingFlow.id}`,
        respond: () => ok(sequence[Math.min(calls++, sequence.length - 1)]),
      },
    ]);
    const { result } = renderHook(() => useFlow(generatingFlow.id, { pollIntervalMs: 10 }), {
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
    const { result } = renderHook(() => useFlow(generatingFlow.id, { pollIntervalMs: 10 }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await sleep(60);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("a response that does not match the DTO is an error, not a crash", async () => {
    mockFetch([{ match: () => true, respond: () => ok({ ...readyFlow, nodes: "nope" }) }]);
    const { result } = renderHook(() => useFlow(readyFlow.id), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).code).toBe("INVALID_RESPONSE");
  });
});

describe("useFlows", () => {
  it("returns the flow summaries", async () => {
    mockFetch([{ match: (u) => u === "/api/flows", respond: () => ok({ flows: flowSummaries }) }]);
    const { result } = renderHook(() => useFlows(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(flowSummaries));
  });
});

describe("useGenerate", () => {
  it("the Phase 3a gate is off", () => {
    expect(isGenerateApiReady()).toBe(false);
  });

  it("POSTs one recommendation id and returns the flow ids", async () => {
    const fetchMock = mockFetch([
      {
        method: "POST",
        match: (u) => u === "/api/recommendations/generate",
        respond: () => ok({ flowIds: [flowId(1)] }, 202),
      },
    ]);
    const { result } = renderHook(() => useGenerate(), { wrapper: wrapper() });
    result.current.mutate({ recommendationId: readyFlow.recommendationId });
    await waitFor(() => expect(result.current.data).toEqual({ flowIds: [flowId(1)] }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ recommendationIds: [readyFlow.recommendationId] });
  });

  it("sends allowStale only when asked", async () => {
    const fetchMock = mockFetch([
      { method: "POST", match: () => true, respond: () => ok({ flowIds: [flowId(1)] }, 202) },
    ]);
    const { result } = renderHook(() => useGenerate(), { wrapper: wrapper() });
    result.current.mutate({ recommendationId: readyFlow.recommendationId, allowStale: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      recommendationIds: [readyFlow.recommendationId],
      allowStale: true,
    });
  });
});

describe("downloadFlowExport", () => {
  it("accepts only the promised file name shape", () => {
    expect(exportFilename('attachment; filename="notify-slack.n8n.json"')).toBe("notify-slack.n8n.json");
    expect(exportFilename('attachment; filename="../../evil.sh"')).toBe("flow.n8n.json");
    expect(exportFilename('attachment; filename="<b>x</b>.n8n.json"')).toBe("flow.n8n.json");
    expect(exportFilename(null)).toBe("flow.n8n.json");
  });

  it("saves the response body as a file", async () => {
    const body = JSON.stringify({ name: "x" }, null, 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "Content-Disposition": 'attachment; filename="x.n8n.json"' },
          }),
      ),
    );
    const blobs: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          blobs.push(blob);
          return "blob:x";
        },
        revokeObjectURL: vi.fn(),
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await expect(downloadFlowExport(readyFlow.id)).resolves.toEqual({ filename: "x.n8n.json" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(await blobs[0]!.text()).toBe(body);
    // The temporary link does not stay in the page.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("throws the API error for an envelope failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: { code: "EXPORT_NOT_VALID", message: "no" } }), {
            status: 409,
          }),
      ),
    );
    await expect(downloadFlowExport(readyFlow.id)).rejects.toMatchObject({ code: "EXPORT_NOT_VALID", status: 409 });
  });

  it("maps a non-JSON failure and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    await expect(downloadFlowExport(readyFlow.id)).rejects.toMatchObject({ code: "INTERNAL" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(downloadFlowExport(readyFlow.id)).rejects.toMatchObject({ code: "NETWORK" });
  });
});
