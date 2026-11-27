import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { RecommendationsList } from "@/features/analysis/components/recommendations-list";
import { doneRecommendations } from "@/features/analysis/fixtures";
import type { Recommendation } from "@/features/analysis/schemas";
import { flowId } from "@/features/flows/fixtures";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

const base = doneRecommendations[0]!;
const rec = (overrides: Partial<Recommendation>): Recommendation => ({ ...base, ...overrides });
const card = () => within(document.querySelector(`[data-recommendation="${base.id}"]`) as HTMLElement);
const SHA = "abc1234def5678900000000000000000000000ab";
const PROJECT_ID = "proj/1";
const listProps = { projectId: PROJECT_ID, analysisCommitSha: SHA };

describe("recommendation card action area (D-42)", () => {
  it("has no checkbox, no selected state, and no selected bar", () => {
    renderWithQuery(<RecommendationsList recommendations={doneRecommendations} {...listProps} />);
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

  it("new without a flow: an enabled Generate flow with no hint and no link", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} {...listProps} />);
    const button = card().getByRole("button", { name: "Generate flow" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(card().queryByRole("link")).not.toBeInTheDocument();
  });

  it("new with a failed flow: the last-attempt text, View details, and an enabled Try again", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: flowId(12) })]} {...listProps} />);
    expect(card().getByText("The last attempt did not produce a flow.")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "View details" })).toHaveAttribute("href", `/flows/${flowId(12)}`);
    expect(card().getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(card().queryByRole("button", { name: "Generate flow" })).not.toBeInTheDocument();
  });

  it("selected: Generating badge with View progress and no button", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "selected", flowId: flowId(1) })]} {...listProps} />);
    expect(card().getByText("Generating")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "View progress" })).toHaveAttribute("href", `/flows/${flowId(1)}`);
    expect(card().queryByRole("button")).not.toBeInTheDocument();
  });

  it("generated: Flow ready badge with Open flow and no button", () => {
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "generated", flowId: flowId(2) })]} {...listProps} />);
    expect(card().getByText("Flow ready")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "Open flow" })).toHaveAttribute("href", `/flows/${flowId(2)}`);
    expect(card().queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Generate flow (live, OC-8)", () => {
  it("posts one id, shows Starting…, and goes to the new flow", async () => {
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
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} {...listProps} />);
    const button = card().getByRole("button", { name: "Generate flow" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await card().findByRole("button", { name: "Starting…" })).toBeDisabled();
    release();
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(7)}`));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ recommendationIds: [base.id] });
  });

  it("a double-click on Generate flow posts { recommendationIds: [id] } exactly once and navigates", async () => {
    const fetchMock = mockFetch([
      {
        method: "POST",
        match: (u) => u === "/api/recommendations/generate",
        respond: () => ok({ flowIds: [flowId(7)] }, 202),
      },
    ]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} {...listProps} />);
    const button = card().getByRole("button", { name: "Generate flow" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(7)}`));
    const sent = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(sent).toEqual([{ recommendationIds: [base.id] }]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("Try again posts the same body and navigates to the new flow", async () => {
    const fetchMock = mockFetch([
      {
        method: "POST",
        match: (u) => u === "/api/recommendations/generate",
        respond: () => ok({ flowIds: [flowId(8)] }, 202),
      },
    ]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: flowId(12) })]} {...listProps} />);
    fireEvent.click(card().getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(8)}`));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ recommendationIds: [base.id] });
  });

  it("a failed start shows a plain notice inside the card", async () => {
    mockFetch([{ method: "POST", match: () => true, respond: () => fail("INTERNAL", "boom", 500) }]);
    renderWithQuery(<RecommendationsList recommendations={[rec({ status: "new", flowId: null })]} {...listProps} />);
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    expect(await card().findByText("Could not start generation. Try again.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

const GENERATE_URL = "/api/recommendations/generate";
const REFRESH_NOTICE =
  "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.";

function renderNew(commitSha: string | null = SHA) {
  return renderWithQuery(
    <RecommendationsList
      recommendations={[rec({ status: "new", flowId: null })]}
      projectId={PROJECT_ID}
      analysisCommitSha={commitSha}
    />,
  );
}

const posts = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("generate errors inside the card (OC-4)", () => {
  const cases: { code: string; message: string; status: number; notice: string; text: string }[] = [
    {
      code: "VALIDATION_ERROR",
      message: "A flow already exists for this recommendation.",
      status: 400,
      notice: "generate-validation",
      text: "A flow already exists for this recommendation.",
    },
    {
      code: "VALIDATION_ERROR",
      message: "Reconnect GitHub to generate flows",
      status: 400,
      notice: "generate-validation",
      text: "Reconnect GitHub to generate flows",
    },
    {
      code: "DAILY_CAP_REACHED",
      message: "cap",
      status: 429,
      notice: "generate-daily-cap",
      text: "Daily limit reached (30 flows per day). It resets at 00:00 UTC.",
    },
    {
      code: "GITHUB_REFRESH_REQUIRED",
      message: "refresh",
      status: 403,
      notice: "refresh-access",
      text: REFRESH_NOTICE,
    },
    {
      code: "RATE_LIMITED",
      message: "slow down",
      status: 429,
      notice: "generate-rate-limited",
      text: "Too many requests, try again in a minute",
    },
    {
      code: "INTERNAL",
      message: "boom",
      status: 500,
      notice: "generate-error",
      text: "Could not start generation. Try again.",
    },
    {
      code: "NOT_FOUND",
      message: "Not found",
      status: 404,
      notice: "generate-error",
      text: "Could not start generation. Try again.",
    },
  ];

  for (const c of cases) {
    it(`${c.code} (${c.status}) "${c.message}" shows its notice inside the card and does not navigate`, async () => {
        mockFetch([{ method: "POST", match: (u) => u === GENERATE_URL, respond: () => fail(c.code, c.message, c.status) }]);
      renderNew();
      fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
      expect(await card().findByText(c.text)).toBeInTheDocument();
      const cardEl = document.querySelector(`[data-recommendation="${base.id}"]`) as HTMLElement;
      expect(cardEl.querySelector(`[data-notice="${c.notice}"]`)).not.toBeNull();
      expect(push).not.toHaveBeenCalled();
    });
  }

  it("GITHUB_REFRESH_REQUIRED shows the Refresh repository access link", async () => {
    mockFetch([{ method: "POST", match: () => true, respond: () => fail("GITHUB_REFRESH_REQUIRED", "x", 403) }]);
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    expect(await card().findByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
  });

  it("a network failure shows the generic notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    expect(await card().findByText("Could not start generation. Try again.")).toBeInTheDocument();
  });
});

describe("stale-analysis dialog (OC-5)", () => {
  const TITLE = "This analysis is out of date";
  const BODY_PREFIX = "New commits were pushed after this analysis. The flow would be built from the analyzed commit";

  function staleThen(second: () => ReturnType<typeof ok> | ReturnType<typeof fail>) {
    let calls = 0;
    return mockFetch([
      {
        method: "POST",
        match: (u) => u === GENERATE_URL,
        respond: () => {
          calls += 1;
          return calls === 1 ? fail("PROJECT_STALE_ANALYSIS", "stale", 409) : second();
        },
      },
    ]);
  }

  it("a 409 stale envelope opens the dialog with the exact title, body, and 7-character sha; no inline notice", async () => {
    staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(TITLE);
    expect(within(dialog).getByText(SHA.slice(0, 7))).toHaveClass("font-mono");
    expect(dialog.textContent).toContain(`${BODY_PREFIX} ${SHA.slice(0, 7)}.`);
    expect(document.querySelector("[data-notice]")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("the body ends without a sha when the analysis commitSha is null", async () => {
    staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew(null);
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(`${BODY_PREFIX}.`)).toBeInTheDocument();
  });

  it("Generate anyway posts allowStale once, closes the dialog, and navigates", async () => {
    const fetchMock = staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate anyway" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(9)}`));
    const sent = posts(fetchMock).map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(sent).toEqual([{ recommendationIds: [base.id] }, { recommendationIds: [base.id], allowStale: true }]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("a double-click on Generate anyway sends exactly one allowStale POST (R3bu-1)", async () => {
    const fetchMock = staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const button = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Generate anyway" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/flows/${flowId(9)}`));
    const sent = posts(fetchMock).map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(sent).toEqual([{ recommendationIds: [base.id] }, { recommendationIds: [base.id], allowStale: true }]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("an error from Generate anyway shows through the card notice", async () => {
    staleThen(() => fail("DAILY_CAP_REACHED", "cap", 429));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Generate anyway" }));
    expect(
      await card().findByText("Daily limit reached (30 flows per day). It resets at 00:00 UTC."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("Re-analyze links to the project page", async () => {
    staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("link", { name: "Re-analyze" })).toHaveAttribute(
      "href",
      `/projects/${encodeURIComponent(PROJECT_ID)}`,
    );
  });

  it("Esc closes the dialog without a request", async () => {
    const fetchMock = staleThen(() => ok({ flowIds: [flowId(9)] }, 202));
    renderNew();
    fireEvent.click(card().getByRole("button", { name: "Generate flow" }));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });
});
