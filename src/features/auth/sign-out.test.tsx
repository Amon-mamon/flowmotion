import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { useSignOut } from "@/features/auth/queries";
import { fail, mockFetch, ok } from "@/features/test-utils/render";

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(["profile"], { id: "x" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useSignOut(), { wrapper }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

describe("useSignOut", () => {
  it("POSTs, clears the cache, and goes to /login", async () => {
    const fetchMock = mockFetch([
      { method: "POST", match: (u) => u === "/api/auth/sign-out", respond: () => ok({ signedOut: true }) },
    ]);
    const { result, client } = setup();
    act(() => result.current.mutate());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["profile"])).toBeUndefined();
  });

  it("treats a 401 (session already gone) as signed out", async () => {
    mockFetch([
      { method: "POST", match: (u) => u === "/api/auth/sign-out", respond: () => fail("UNAUTHORIZED", "x", 401) },
    ]);
    const { result } = setup();
    act(() => result.current.mutate());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(result.current.isError).toBe(false);
  });

  it("stays on the page and exposes the error on other failures", async () => {
    mockFetch([
      { method: "POST", match: (u) => u === "/api/auth/sign-out", respond: () => fail("INTERNAL", "x", 500) },
    ]);
    const { result } = setup();
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(push).not.toHaveBeenCalled();
  });
});
