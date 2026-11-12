import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** Renders with a fresh QueryClient (no retries) for component tests. */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

type Route = {
  method?: string;
  match: (url: string) => boolean;
  respond: () => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
};

/** Installs a fetch mock that answers `/api/*` calls with envelope bodies. */
export function mockFetch(routes: Route[]) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const route = routes.find((r) => (r.method ?? "GET") === method && r.match(url));
    if (!route) {
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "no route" } }), {
        status: 404,
      });
    }
    const { status = 200, body } = await route.respond();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const ok = (data: unknown, status = 200) => ({ status, body: { ok: true, data } });
export const fail = (code: string, message: string, status: number) => ({
  status,
  body: { ok: false, error: { code, message } },
});
