import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecentFlows } from "@/features/flows/components/recent-flows";
import { flowId, flowSummaries } from "@/features/flows/fixtures";
import type { FlowSummary } from "@/features/flows/schemas";
import { formatDate } from "@/hooks/use-format-date";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => vi.unstubAllGlobals());

const isFlows = (u: string) => u === "/api/flows";
const row = (id: string) => document.querySelector(`[data-flow="${id}"]`) as HTMLElement;

describe("RecentFlows (design.md Dashboard Recent flows)", () => {
  it("shows row skeletons while loading", () => {
    mockFetch([{ match: isFlows, respond: () => new Promise(() => {}) }]);
    renderWithQuery(<RecentFlows />);
    expect(screen.getByRole("status", { name: "Loading flows" })).toHaveAttribute("aria-busy", "true");
  });

  it("one row per status with exact labels, hrefs, repo in mono, and the created date", async () => {
    mockFetch([{ match: isFlows, respond: () => ok({ flows: flowSummaries }) }]);
    renderWithQuery(<RecentFlows />);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(flowSummaries.length));

    const expected: Record<FlowSummary["status"], string> = {
      generating: "Generating",
      ready: "Ready",
      failed: "Failed",
    };
    const statuses = new Set<string>();
    for (const flow of flowSummaries) {
      const link = row(flow.id);
      expect(link).toHaveAttribute("href", `/flows/${encodeURIComponent(flow.id)}`);
      const r = within(link);
      expect(r.getByText(flow.name)).toBeInTheDocument();
      expect(r.getByText(flow.repoFullName)).toHaveClass("font-mono");
      expect(r.getByText(expected[flow.status])).toBeInTheDocument();
      expect(link.querySelector(`[data-status="${flow.status}"] svg`)).not.toBeNull();
      expect(r.getByText(formatDate(flow.createdAt))).toBeInTheDocument();
      statuses.add(flow.status);
    }
    expect(statuses).toEqual(new Set(["generating", "ready", "failed"]));
  });

  it("an empty list shows No flows yet", async () => {
    mockFetch([{ match: isFlows, respond: () => ok({ flows: [] }) }]);
    renderWithQuery(<RecentFlows />);
    expect(await screen.findByText("No flows yet")).toBeInTheDocument();
    expect(
      screen.getByText("Generated flows will appear here once a project has been analyzed."),
    ).toBeInTheDocument();
  });

  it("an error envelope shows Could not load flows and Retry refetches", async () => {
    let calls = 0;
    const fetchMock = mockFetch([
      {
        match: isFlows,
        respond: () => (calls++ === 0 ? fail("INTERNAL", "boom", 500) : ok({ flows: flowSummaries })),
      },
    ]);
    renderWithQuery(<RecentFlows />);
    expect(await screen.findByText("Could not load flows")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(flowSummaries.length));
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/flows")).toHaveLength(2);
  });

  it("keeps a name containing <script> literal", async () => {
    const evil: FlowSummary = { ...flowSummaries[1]!, id: flowId(99), name: "<script>alert(1)</script>" };
    mockFetch([{ match: isFlows, respond: () => ok({ flows: [evil] }) }]);
    renderWithQuery(<RecentFlows />);
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(row(evil.id).querySelector("script")).toBeNull();
  });

  it("renders at most 20 rows", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...flowSummaries[1]!, id: flowId(100 + i) }));
    mockFetch([{ match: isFlows, respond: () => ok({ flows: many }) }]);
    renderWithQuery(<RecentFlows />);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(20));
  });
});
