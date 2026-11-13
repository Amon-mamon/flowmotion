import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// No test may reach a real network (contract Phase 2 item 12). Tests that need
// fetch inject their own (or use vi.stubGlobal, which restores to this stub).
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Network access is blocked in tests: ${url}`);
}) as typeof fetch;
