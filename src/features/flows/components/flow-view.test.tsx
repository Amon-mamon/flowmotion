import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => notFound(),
}));

import { FlowView } from "@/features/flows/components/flow-view";
import {
  ALL_WARNINGS,
  failedFlows,
  generatingFlow,
  minimalFlow,
  readyFlow,
  verifiedFlow,
} from "@/features/flows/fixtures";
import { JOB_ERROR_CODES, type FlowDetail, type JobErrorCode } from "@/features/flows/schemas";
import { fail, mockFetch, renderWithQuery } from "@/features/test-utils/render";
import { useFlowCanvasStore } from "@/stores/flow-canvas";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  notFound.mockReset();
  useFlowCanvasStore.setState({ selectedNodeKey: null });
});

type ExportRoute = () => Response | Promise<Response>;

/** Serves `GET /api/flows/:id` (envelope) and optionally the export route (raw file or envelope error). */
function serve(flow: FlowDetail, exportRoute?: ExportRoute) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `/api/flows/${flow.id}`) {
      return new Response(JSON.stringify({ ok: true, data: flow }), { status: 200 });
    }
    if (url === `/api/flows/${flow.id}/export` && exportRoute) return exportRoute();
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "no route" } }), {
      status: 404,
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const view = (flow: FlowDetail) => renderWithQuery(<FlowView flowId={flow.id} pollIntervalMs={60_000} />);

const analysisHref = (flow: FlowDetail) => `/projects/${flow.projectId}/analysis/${flow.analysisId}`;

const nodeButton = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });

describe("FlowView: loading and errors", () => {
  it("shows a skeleton, then an error state with retry", async () => {
    mockFetch([{ match: () => true, respond: () => fail("INTERNAL", "boom", 500) }]);
    renderWithQuery(<FlowView flowId={readyFlow.id} />);
    expect(screen.getByRole("status", { name: "Loading flow" })).toBeInTheDocument();
    expect(await screen.findByText("Could not load flow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("an unknown flow is a 404", async () => {
    mockFetch([{ match: () => true, respond: () => fail("NOT_FOUND", "Not found", 404) }]);
    renderWithQuery(<FlowView flowId={readyFlow.id} />);
    await waitFor(() => expect(notFound).toHaveBeenCalled());
  });
});

describe("FlowView: generating", () => {
  it("shows the header, the exact text, a skeleton canvas, and no export panel", async () => {
    serve(generatingFlow);
    view(generatingFlow);
    expect(await screen.findByRole("heading", { level: 1, name: generatingFlow.name })).toBeInTheDocument();
    expect(screen.getByText("Generating your flow. This usually takes less than two minutes.")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to analysis" })).toHaveAttribute(
      "href",
      analysisHref(generatingFlow),
    );
    expect(screen.getByTestId("flow-repo")).toHaveTextContent(generatingFlow.repoFullName);
    expect(screen.queryByText("Export to n8n")).not.toBeInTheDocument();
    expect(screen.queryByText("Valid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download n8n JSON" })).not.toBeInTheDocument();
  });
});

describe("FlowView: failed", () => {
  const EXPECTED: Readonly<Record<JobErrorCode, string>> = {
    GENERATION_EXHAUSTED: "Could not generate a valid flow after 3 attempts.",
    AI_UNAVAILABLE: "The AI service did not respond. Try again later.",
    AI_DISABLED: "AI generation is not enabled yet.",
    GITHUB_ACCESS_LOST: "Flow Motion can no longer read this repository. Reconnect GitHub and try again.",
    JOB_EXPIRED: "Generation stopped making progress and was cancelled. Try again.",
    PROJECT_INVALID: "Something went wrong while generating this flow. Try again.",
    BRANCH_NOT_FOUND: "Something went wrong while generating this flow. Try again.",
    MODEL_OUTPUT_INVALID: "Something went wrong while generating this flow. Try again.",
    INTERNAL: "Something went wrong while generating this flow. Try again.",
  };

  it.each(JOB_ERROR_CODES)("%s shows its exact message and the way back", async (code) => {
    const flow = failedFlows[code];
    serve(flow);
    view(flow);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", code);
    expect(within(alert).getByText(EXPECTED[code])).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "Back to analysis" })).toHaveAttribute(
      "href",
      analysisHref(flow),
    );
    expect(screen.queryByText("Export to n8n")).not.toBeInTheDocument();
    expect(screen.queryByTestId("canvas-skeleton")).not.toBeInTheDocument();
    // No retry here (the user retries from the recommendation card) and no provider name.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/openrouter|anthropic|claude|gpt/i);
  });

  it("a failed flow without a code uses the generic message", async () => {
    const flow = { ...failedFlows.INTERNAL, errorCode: null };
    serve(flow);
    view(flow);
    expect(
      await screen.findByText("Something went wrong while generating this flow. Try again."),
    ).toBeInTheDocument();
  });
});

describe("FlowView: ready", () => {
  it("header shows the Valid level with its exact sentence and the n8n version", async () => {
    serve(readyFlow);
    view(readyFlow);
    expect(await screen.findByRole("heading", { level: 1, name: readyFlow.name })).toBeInTheDocument();
    expect(screen.getByTestId("flow-description")).toHaveTextContent(readyFlow.description!);
    const level = within(screen.getByTestId("flow-level"));
    expect(level.getByText("Valid")).toBeInTheDocument();
    expect(
      level.getByText("Passed Flow Motion's structure checks. It has not been tested with mock data yet."),
    ).toBeInTheDocument();
    expect(level.getByText("Compatible with n8n 1.74")).toBeInTheDocument();
    // Phase 3 has no test panel, Run test button, or Simulated badge.
    expect(screen.queryByText(/Simulated/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run test/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/guarantee/i);
  });

  it("canvas renders a card per node with type, Trigger tag, and credential marker, in graph order", async () => {
    serve(readyFlow);
    view(readyFlow);
    const canvas = within(await screen.findByRole("region", { name: "Flow canvas" }));
    const buttons = canvas
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-haspopup"));
    expect(buttons.map((button) => button.querySelector("span span")?.textContent)).toEqual([
      "Order webhook",
      "Is paid order",
      "Notify team",
      "Fetch order details",
      "Join branches",
      "Log order",
      "Reply to caller",
    ]);

    const card = (key: string) => document.querySelector(`[data-node-key="${key}"]`) as HTMLElement;
    expect(within(card("notify_team")).getByText("slack")).toBeInTheDocument();
    expect(within(card("order_webhook")).getByText("Trigger")).toBeInTheDocument();
    expect(within(card("is_paid")).queryByText("Trigger")).not.toBeInTheDocument();
    expect(card("notify_team").querySelector("[data-needs-credential]")).not.toBeNull();
    expect(card("is_paid").querySelector("[data-needs-credential]")).toBeNull();
    // Read-only: zoom controls, no minimap.
    expect(canvas.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(document.querySelector(".react-flow__minimap")).toBeNull();
  });

  it("edges leaving the if node carry the labels true and false; single-output edges have none", async () => {
    serve(readyFlow);
    view(readyFlow);
    await screen.findByRole("region", { name: "Flow canvas" });
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(readyFlow.edges.length));
    const labels = Array.from(document.querySelectorAll(".react-flow__edge-text")).map((el) => el.textContent);
    expect(labels.sort()).toEqual(["false", "true"]);
  });

  it("a node click opens the inspector with its rows; the close button closes it", async () => {
    serve(readyFlow);
    view(readyFlow);
    await screen.findByRole("region", { name: "Flow canvas" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(nodeButton("Notify team"));
    const dialog = within(await screen.findByRole("dialog", { name: "Notify team" }));
    // The page behind the modal drawer is hidden from assistive tech, so query the DOM directly.
    const selectedCard = document.querySelector('[data-node-key="notify_team"] button');
    expect(selectedCard).toHaveAttribute("data-selected", "true");
    expect(selectedCard).toHaveClass("border-primary");

    expect(dialog.getByText("Type")).toBeInTheDocument();
    expect(dialog.getByTestId("inspector-short-type")).toHaveTextContent("slack");
    expect(dialog.getByText("n8n-nodes-base.slack")).toBeInTheDocument();
    expect(dialog.getByText("Parameters")).toBeInTheDocument();
    const tree = within(dialog.getByTestId("param-tree"));
    expect(tree.getByText("channel")).toBeInTheDocument();
    expect(tree.getByText("YOUR_SLACK_CHANNEL")).toBeInTheDocument();
    expect(tree.getByText("New paid order {{ $json.id }}")).toBeInTheDocument();
    expect(dialog.getByText("Credential")).toBeInTheDocument();
    expect(dialog.getByText("Needs a Slack credential in n8n")).toBeInTheDocument();
    expect(dialog.getByText("Source files")).toBeInTheDocument();
    expect(dialog.getByText("src/app/api/orders/route.ts")).toBeInTheDocument();
    // Notes row is omitted when null; nothing is editable.
    expect(dialog.queryByText("Notes")).not.toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useFlowCanvasStore.getState().selectedNodeKey).toBeNull();
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("%s on a focused node opens the inspector and Esc closes it", async (_name, key) => {
    serve(readyFlow);
    view(readyFlow);
    await screen.findByRole("region", { name: "Flow canvas" });
    const node = nodeButton("Order webhook");
    node.focus();
    expect(node).toHaveFocus();
    fireEvent.keyDown(node, { key });

    const dialog = await screen.findByRole("dialog", { name: "Order webhook" });
    const rows = within(dialog);
    expect(rows.getByText("No credential needed")).toBeInTheDocument();
    expect(rows.getByText("Notes")).toBeInTheDocument();
    expect(rows.getByText("Receives the same payload the app posts to /api/orders.")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useFlowCanvasStore.getState().selectedNodeKey).toBeNull();
  });

  it("empty inspector rows use the exact empty texts", async () => {
    serve(minimalFlow);
    view(minimalFlow);
    await screen.findByRole("region", { name: "Flow canvas" });
    fireEvent.click(nodeButton("Start"));
    const dialog = within(await screen.findByRole("dialog", { name: "Start" }));
    expect(dialog.getByText("No parameters")).toBeInTheDocument();
    expect(dialog.getByText("No credential needed")).toBeInTheDocument();
    expect(dialog.getByText("None")).toBeInTheDocument();
    expect(dialog.queryByText("Notes")).not.toBeInTheDocument();
  });

  it("an HTML string in a name, label, param, or note stays literal text", async () => {
    const html = '<img src=x onerror="alert(1)">';
    const flow: FlowDetail = {
      ...readyFlow,
      name: "<h1>Pwn</h1>",
      description: "<script>alert(1)</script>",
      nodes: readyFlow.nodes.map((node) =>
        node.key === "notify_team"
          ? {
              ...node,
              label: "<b>Notify</b>",
              params: { channel: html, nested: { "<i>key</i>": ["<u>deep</u>"] } },
              credential: "<em>Slack</em>",
              sourceFiles: ["<a href=x>file</a>"],
              notes: "<marquee>note</marquee>",
            }
          : node,
      ),
      checklist: {
        credentials: [{ name: "<em>Slack</em>", usedBy: ["<b>Notify</b>"] }],
        placeholders: [{ name: "<s>YOUR_X</s>", usedBy: ["<b>Notify</b>"] }],
        warnings: ["<blink>warn</blink>"],
      },
    };
    serve(flow);
    view(flow);
    expect(await screen.findByRole("heading", { level: 1, name: "<h1>Pwn</h1>" })).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("<blink>warn</blink>")).toBeInTheDocument();
    expect(screen.getByText("<s>YOUR_X</s>")).toBeInTheDocument();

    fireEvent.click(nodeButton("<b>Notify</b>"));
    const dialog = within(await screen.findByRole("dialog", { name: "<b>Notify</b>" }));
    expect(dialog.getByText(html)).toBeInTheDocument();
    expect(dialog.getByText("<i>key</i>")).toBeInTheDocument();
    expect(dialog.getByText("<u>deep</u>")).toBeInTheDocument();
    expect(dialog.getByText("Needs a <em>Slack</em> credential in n8n")).toBeInTheDocument();
    expect(dialog.getByText("<a href=x>file</a>")).toBeInTheDocument();
    expect(dialog.getByText("<marquee>note</marquee>")).toBeInTheDocument();

    for (const tag of ["img", "script", "marquee", "blink", "b", "i", "u", "em", "s"]) {
      expect(document.body.querySelector(tag)).toBeNull();
    }
    // The only h1 is the page heading itself.
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
  });
});

describe("FlowView: export panel", () => {
  const section = (id: string) => within(document.querySelector(`[data-checklist="${id}"]`) as HTMLElement);

  it("lists credentials, values to replace, and warnings with the exact copy", async () => {
    serve(readyFlow);
    view(readyFlow);
    expect(await screen.findByRole("heading", { level: 2, name: "Export to n8n" })).toBeInTheDocument();
    expect(screen.getByText("Before you run it in n8n")).toBeInTheDocument();

    expect(section("credentials").getByText("Credentials to connect")).toBeInTheDocument();
    expect(section("credentials").getByText("Slack, used by Notify team")).toBeInTheDocument();
    expect(section("credentials").getByText("Postgres, used by Log order")).toBeInTheDocument();

    expect(section("placeholders").getByText("Values to replace")).toBeInTheDocument();
    const placeholder = section("placeholders").getByText("YOUR_SLACK_CHANNEL");
    expect(placeholder).toHaveClass("font-mono");
    expect(placeholder.closest("li")).toHaveTextContent("YOUR_SLACK_CHANNEL used by Notify team");
    expect(section("placeholders").getByText("YOUR_API_URL").closest("li")).toHaveTextContent(
      "YOUR_API_URL used by Fetch order details",
    );

    expect(section("warnings").getByText("Check before activating")).toBeInTheDocument();
    const warnings = section("warnings").getAllByRole("listitem").map((li) => li.textContent);
    expect(warnings).toEqual([...ALL_WARNINGS]);

    expect(screen.getByRole("button", { name: "Download n8n JSON" })).toBeEnabled();
    expect(
      screen.getByText(
        "In n8n, choose Import from File and select this file. Flow Motion does not run flows for you.",
      ),
    ).toBeInTheDocument();
  });

  it("empty checklist sections use the exact empty texts", async () => {
    serve(minimalFlow);
    view(minimalFlow);
    await screen.findByRole("heading", { level: 2, name: "Export to n8n" });
    expect(section("credentials").getByText("No credentials needed.")).toBeInTheDocument();
    expect(section("placeholders").getByText("Nothing to replace.")).toBeInTheDocument();
    expect(section("warnings").getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows the not-yet-verified notice with the version only when importVerified is false", async () => {
    serve(readyFlow);
    const first = view(readyFlow);
    expect(await screen.findByText("Import into n8n 1.74 not yet verified")).toBeInTheDocument();
    // Export stays allowed.
    expect(screen.getByRole("button", { name: "Download n8n JSON" })).toBeEnabled();
    first.unmount();

    serve(verifiedFlow);
    view(verifiedFlow);
    await screen.findByRole("heading", { level: 2, name: "Export to n8n" });
    expect(screen.queryByText(/not yet verified/)).not.toBeInTheDocument();
  });

  it("downloads the file through a blob, showing Preparing… while pending", async () => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = serve(readyFlow, () => pending);
    const createObjectURL = vi.fn(() => "blob:flow");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    let downloaded: { href: string; download: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = { href: this.href, download: this.download };
    });

    view(readyFlow);
    fireEvent.click(await screen.findByRole("button", { name: "Download n8n JSON" }));
    const busy = await screen.findByRole("button", { name: "Preparing…" });
    expect(busy).toBeDisabled();

    release(
      new Response(JSON.stringify({ name: "x", nodes: [] }, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="notify-slack-on-new-orders.n8n.json"',
        },
      }),
    );

    expect(await screen.findByRole("button", { name: "Download n8n JSON" })).toBeEnabled();
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/flows/${readyFlow.id}/export`)).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloaded).toEqual({ href: "blob:flow", download: "notify-slack-on-new-orders.n8n.json" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:flow");
    expect(document.querySelector("[data-notice=download-error]")).toBeNull();
  });

  it.each([
    ["EXPORT_NOT_VALID", 409, "This flow cannot be exported. Generate it again from the recommendation."],
    ["RATE_LIMITED", 429, "Too many requests, try again in a minute"],
    ["INTERNAL", 500, "Could not download the file. Try again."],
  ])("%s is shown inline", async (code, status, text) => {
    serve(
      readyFlow,
      () => new Response(JSON.stringify({ ok: false, error: { code, message: "server text" } }), { status }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    view(readyFlow);
    fireEvent.click(await screen.findByRole("button", { name: "Download n8n JSON" }));
    const alert = await screen.findByText(text);
    expect(alert).toHaveAttribute("data-notice", "download-error");
    expect(screen.queryByText("server text")).not.toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download n8n JSON" })).toBeEnabled();
  });
});
