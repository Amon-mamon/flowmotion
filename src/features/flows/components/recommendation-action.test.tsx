import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const ready = vi.fn(() => false);
vi.mock("@/features/flows/readiness", () => ({ isGenerateApiReady: () => ready() }));

import { RecommendationsList } from "@/features/analysis/components/recommendations-list";
import { doneRecommendations } from "@/features/analysis/fixtures";
import type { Recommendation } from "@/features/analysis/schemas";
import { flowId } from "@/features/flows/fixtures";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  ready.mockReset();
  ready.mockImplementation(() => false);
});

const base = doneRecommendations[0]!;
const rec = (overrides: Partial<Recommendation>): Recommendation => ({ ...base, ...overrides });
const card = () => within(document.querySelector(`[data-recommendation="${base.id}"]`) as HTMLElement);
const HINT = "Flow generation is being set up.";

describe("recommendation card action area (D-42), Generate API gated off", () => {
  it("has no checkbox, no selected state, and no selected bar", () => {
    renderWithQuery(<RecommendationsList recommendations={doneRecommendations} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(document.querySelector("input")).toBeNull();
    expect(document.querySelector("[data-selected]")).toBeNull();
    expect(screen.queryByText(/\d+ selected/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("selected-count")).not.toBeInTheDocument();
    // One button per card, never a bulk Generate.
    expect(screen.getAllByRole("button", { name: "Generate flow" })).toHaveLength(doneRecommendations.length);
    expect(
      screen.getByText("Each flow is generated on its own. You can generate up to 30 flows per day."),
    ).toBeInTheDocument();
  });

  it("new without a flow: disabled Generate flow with the set-up hint", () => {
    const fetchMock = mockFetch([]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} />);
    const button = card().getByRole("button", { name: "Generate flow" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(HINT);
    expect(card().getByText(HINT)).toBeInTheDocument();
    expect(card().queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("new with a failed flow: the last-attempt text, View details, and a disabled Try again", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: flowId(12) })]} />);
    expect(card().getByText("The last attempt did not produce a flow.")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "View details" })).toHaveAttribute("href", `/flows/${flowId(12)}`);
    const button = card().getByRole("button", { name: "Try again" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(HINT);
    expect(card().queryByRole("button", { name: "Generate flow" })).not.toBeInTheDocument();
  });

  it("selected: Generating badge with View progress and no button", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "selected", flowId: flowId(1) })]} />);
    expect(card().getByText("Generating")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "View progress" })).toHaveAttribute("href", `/flows/${flowId(1)}`);
    expect(card().queryByRole("button")).not.toBeInTheDocument();
    expect(card().queryByText(HINT)).not.toBeInTheDocument();
  });

  it("generated: Flow ready badge with Open flow and no button", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "generated", flowId: flowId(2) })]} />);
    expect(card().getByText("Flow ready")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "Open flow" })).toHaveAttribute("href", `/flows/${flowId(2)}`);
    expect(card().queryByRole("button")).not.toBeInTheDocument();
    expect(card().queryByText(HINT)).not.toBeInTheDocument();
  });
});

describe("recommendation card action area once the Generate API is ready (Phase 3b switch)", () => {
  it("posts one id, shows Starting…, and goes to the new flow", async () => {
    ready.mockImplementation(() => true);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = mockFetch([
      {
        method: "POST",
        match: (u) => u === "/api/recommendations/generate",
        respond: async () => {
          await gate;
          return ok({ flowIds: [flowId(7)] }, 202);
        },
      },
    ]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} />);
    const button = card().getByRole("button", { name: "Generate flow" });
    expect(button).toBeEnabled();
    expect(card().queryByText(HINT)).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(await card().findByRole("button", { name: "Starting…" })).toBeDisabled();
    release();
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(7)}`));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ recommendationIds: [base.id] });
  });

  it("a failed start shows a plain notice inside the card", async () => {
    ready.mockImplementation(() => true);
    mockFetch([{ method: "POST", match: () => true, respond: () => fail("INTERNAL", "boom", 500) }]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} />);
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    expect(await card().findByText("Could not start generation. Try again.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
