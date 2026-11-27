import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationsView } from "@/features/integrations/components/integrations-view";
import { INTEGRATIONS_COPY, TEST_RESULT_COPY } from "@/features/integrations/copy";
import { PREVIEW_STATES, type PreviewStateId } from "@/features/integrations/fixtures";
import type { AiTestResult } from "@/features/integrations/types";

/*
 * Phase 2e-ui item 5 (b)-(h), (j). Rendered without a QueryClientProvider on purpose:
 * any TanStack Query hook in the feature would throw.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(<IntegrationsView />);
}

function choosePreviewState(id: PreviewStateId) {
  fireEvent.change(screen.getByLabelText("Preview state"), { target: { value: id } });
}

function keyInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("API key input not found");
  return input;
}

function modelInput(): HTMLInputElement {
  return screen.getByLabelText("Model");
}

function openNewKeyForm() {
  fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
}

describe("Integrations page: preview notice (b)", () => {
  it("renders headings, explanation, and the preview notice with its select", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByText(INTEGRATIONS_COPY.pageDescription)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "AI provider" })).toBeInTheDocument();
    expect(screen.getByText(INTEGRATIONS_COPY.explanation)).toBeInTheDocument();
    expect(screen.getByText("Preview — keys are not saved yet")).toBeInTheDocument();
    expect(
      screen.getByText("This shows how your own AI key will work. Nothing you type here is saved or sent anywhere."),
    ).toBeInTheDocument();
    const select = screen.getByLabelText("Preview state");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "No key saved",
      "Saved, not tested",
      "Working",
      "Invalid key",
      "No credit",
      "Model not found",
      "Provider did not respond",
      "Free model",
    ]);
  });

  it("empty state shows the built-in AI text and Add API key", () => {
    renderPage();
    expect(screen.getByText("No API key saved. The built-in AI is used.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add API key" })).toBeEnabled();
  });

  it("Save key is disabled with Coming soon", () => {
    renderPage();
    openNewKeyForm();
    const save = screen.getByRole("button", { name: "Save key" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Coming soon");
  });

  it("Test connection is disabled with Coming soon", () => {
    renderPage();
    choosePreviewState("working");
    const test = screen.getByRole("button", { name: "Test connection" });
    expect(test).toBeDisabled();
    expect(test).toHaveAccessibleDescription("Coming soon");
  });
});

describe("Integrations page: provider switch (c)", () => {
  it("changes the key label, placeholder, and suggested model, and back", () => {
    renderPage();
    openNewKeyForm();
    expect(screen.getByRole("radio", { name: "OpenRouter" })).toHaveAttribute("aria-checked", "true");
    expect(keyInput()).toHaveAccessibleName("OpenRouter API key");
    expect(keyInput()).toHaveAttribute("placeholder", "sk-or-…");
    expect(modelInput()).toHaveValue("anthropic/claude-haiku-5.5");
    expect(
      screen.getByText("Any model your provider offers can be used, free or paid. Suggested: anthropic/claude-haiku-5.5."),
    ).toBeInTheDocument();
    expect(screen.getByText("Stored encrypted. It is never shown again after you save it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(keyInput()).toHaveAccessibleName("Anthropic API key");
    expect(keyInput()).toHaveAttribute("placeholder", "sk-ant-…");
    expect(modelInput()).toHaveValue("claude-haiku-5-5");
    expect(
      screen.getByText("Any model your provider offers can be used, free or paid. Suggested: claude-haiku-5-5."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "OpenRouter" }));
    expect(keyInput()).toHaveAccessibleName("OpenRouter API key");
    expect(keyInput()).toHaveAttribute("placeholder", "sk-or-…");
    expect(modelInput()).toHaveValue("anthropic/claude-haiku-5.5");
  });

  it("keeps a model the user typed when switching", () => {
    renderPage();
    openNewKeyForm();
    fireEvent.change(modelInput(), { target: { value: "my-vendor/my-model" } });
    fireEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(modelInput()).toHaveValue("my-vendor/my-model");
    fireEvent.click(screen.getByRole("radio", { name: "OpenRouter" }));
    expect(modelInput()).toHaveValue("my-vendor/my-model");
  });

  it("Change opens the form with provider and model filled in and the keep-key helper", () => {
    renderPage();
    choosePreviewState("invalid_key");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("radio", { name: "Anthropic" })).toHaveAttribute("aria-checked", "true");
    expect(modelInput()).toHaveValue("claude-haiku-5-5");
    expect(keyInput().value).toBe("");
    expect(screen.getByText("Leave empty to keep the saved key.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "OpenRouter" }));
    expect(screen.getByText("Stored encrypted. It is never shown again after you save it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("sk-ant-…9c1e")).toBeInTheDocument();
  });

  it("Cancel from the empty state returns to the empty state", () => {
    renderPage();
    openNewKeyForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("No API key saved. The built-in AI is used.")).toBeInTheDocument();
  });
});

describe("Integrations page: saved state (d, e)", () => {
  it("shows provider, model, and keyHint exactly, and nothing else key-shaped", () => {
    const { container } = renderPage();
    choosePreviewState("saved");
    const setting = PREVIEW_STATES.saved.response.setting;
    expect(setting).not.toBeNull();
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("anthropic/claude-haiku-5.5")).toHaveClass("font-mono");
    expect(screen.getByText("sk-or-…4f2a")).toHaveClass("font-mono");
    expect(screen.getByText("Not tested yet")).toBeInTheDocument();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const keyShaped: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      keyShaped.push(...((node.textContent ?? "").match(/sk-[a-z]+-\S*/g) ?? []));
    }
    expect(keyShaped).toEqual(["sk-or-…4f2a"]);
    expect(container.innerHTML.match(/sk-[a-z]+-/g)).toEqual(["sk-or-"]);
  });

  const results: [PreviewStateId, AiTestResult][] = [
    ["working", "working"],
    ["invalid_key", "invalid_key"],
    ["no_credit", "no_credit"],
    ["model_not_found", "model_not_found"],
    ["no_response", "no_response"],
  ];

  it.each(results)("%s renders its exact title and sentence", (id, result) => {
    renderPage();
    choosePreviewState(id);
    const line = screen.getByTestId("test-result");
    expect(within(line).getByText(TEST_RESULT_COPY[result].title)).toBeInTheDocument();
    expect(within(line).getByText(TEST_RESULT_COPY[result].sentence)).toBeInTheDocument();
    expect(within(line).getByText(/^Tested /)).toBeInTheDocument();
    expect(screen.queryByText("Not tested yet")).not.toBeInTheDocument();
  });

  it("shows a fresh test time of five minutes ago, not the fixed fixture date (R2eu-4)", () => {
    vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
    renderPage();
    choosePreviewState("working");
    expect(screen.getByText("Tested 5 minutes ago")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("uses the exact design.md copy for each result", () => {
    expect(TEST_RESULT_COPY).toEqual({
      working: { title: "Working", sentence: "Your key and model answered a test request." },
      invalid_key: { title: "Invalid key", sentence: "The provider rejected this key. Check it and save it again." },
      no_credit: {
        title: "No credit",
        sentence: "Your provider account has no credit left. Add credit with the provider, then test again.",
      },
      model_not_found: {
        title: "Model not found",
        sentence: "The provider does not offer this model. Check the model name.",
      },
      no_response: { title: "Provider did not respond", sentence: "Try again in a minute." },
    });
  });
});

describe("Integrations page: free model warning (f)", () => {
  const warning =
    "Free models may log or train on what they receive, including redacted snippets of your code. Use a paid model for private code.";

  it("shows in the saved state for a :free model only", () => {
    renderPage();
    choosePreviewState("free_model");
    expect(screen.getByText(warning)).toBeInTheDocument();
    choosePreviewState("working");
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it("shows in the form for :free in any case, and not otherwise", () => {
    renderPage();
    openNewKeyForm();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    fireEvent.change(modelInput(), { target: { value: "vendor/model:FREE" } });
    expect(screen.getByText(warning)).toBeInTheDocument();
    fireEvent.change(modelInput(), { target: { value: "vendor/model:free" } });
    expect(screen.getByText(warning)).toBeInTheDocument();
    fireEvent.change(modelInput(), { target: { value: "vendor/free-model" } });
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });
});

describe("Integrations page: remove key (g)", () => {
  it("Cancel keeps the saved state; Remove key returns to the empty state", async () => {
    renderPage();
    choosePreviewState("working");

    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove your API key?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Flow Motion deletes your key. New analyses and flows use the built-in AI again."),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("sk-or-…4f2a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("No API key saved. The built-in AI is used.")).toBeInTheDocument();
    expect(screen.queryByText("sk-or-…4f2a")).not.toBeInTheDocument();
  });
});

describe("Integrations page: the key never leaves the input (h)", () => {
  const MARKER = "sk-or-v1-PREVIEWMARKER0123456789abcdef";
  const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let cookieSetter: ReturnType<typeof vi.fn<(value: string) => void>>;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];
  let restoreCookie: () => void;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    consoleSpies = consoleMethods.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));

    // Watch document.cookie writes wherever the accessor is defined.
    let owner: object | null = document;
    let descriptor: PropertyDescriptor | undefined;
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, "cookie");
      if (!descriptor) owner = Object.getPrototypeOf(owner) as object | null;
    }
    const original = descriptor;
    cookieSetter = vi.fn<(value: string) => void>();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => (original?.get ? (original.get.call(document) as string) : ""),
      set: (value: string) => {
        cookieSetter(value);
        original?.set?.call(document, value);
      },
    });
    restoreCookie = () => {
      delete (document as unknown as Record<string, unknown>).cookie;
    };
  });

  afterEach(() => {
    restoreCookie();
    localStorage.clear();
    sessionStorage.clear();
  });

  function typeMarker() {
    fireEvent.change(keyInput(), { target: { value: MARKER } });
    expect(keyInput().value).toBe(MARKER);
  }

  function enabledButtons(): HTMLElement[] {
    return screen.getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
  }

  function assertNoLeak(container: HTMLElement) {
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const call of setItemSpy.mock.calls) {
      expect(String(call[0])).not.toContain(MARKER);
      expect(String(call[1])).not.toContain(MARKER);
    }
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i) ?? "";
        expect(k).not.toContain(MARKER);
        expect(storage.getItem(k) ?? "").not.toContain(MARKER);
      }
    }
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls.map((args: unknown[]) => args.map(String)))).not.toContain(MARKER);
    }
    for (const call of cookieSetter.mock.calls) {
      expect(String(call[0])).not.toContain(MARKER);
    }
    expect(document.cookie).not.toContain(MARKER);
    expect(container.innerHTML).not.toContain(MARKER);
    expect(document.documentElement.outerHTML).not.toContain(MARKER);
    expect(document.title).not.toContain(MARKER);
    expect(window.location.href).not.toContain(MARKER);
  }

  it("Enter clears the input and nothing is stored, sent, logged, or rendered", () => {
    const { container } = renderPage();
    openNewKeyForm();

    typeMarker();
    fireEvent.keyDown(keyInput(), { key: "Enter" });
    expect(keyInput().value).toBe("");

    typeMarker();
    fireEvent.keyDown(modelInput(), { key: "Enter" });
    expect(keyInput().value).toBe("");

    typeMarker();
    const form = screen.getByRole("form", { name: "AI provider key" });
    fireEvent.submit(form);
    expect(keyInput().value).toBe("");

    assertNoLeak(container);
  });

  it("every enabled button in the form clears the input without leaking it", () => {
    const { container } = renderPage();
    openNewKeyForm();

    // Each enabled form button in turn: Anthropic, OpenRouter radios, then Cancel (closes the form).
    const form = screen.getByRole("form", { name: "AI provider key" });
    const formButtons = within(form)
      .getAllByRole("button")
      .concat(within(form).getAllByRole("radio"))
      .filter((b, i, all) => all.indexOf(b) === i && !(b as HTMLButtonElement).disabled);
    const ordered = [
      ...formButtons.filter((b) => b.getAttribute("role") === "radio" && b.getAttribute("aria-checked") === "false"),
      ...formButtons.filter((b) => b.getAttribute("role") === "radio" && b.getAttribute("aria-checked") === "true"),
      ...formButtons.filter((b) => b.getAttribute("role") !== "radio"),
    ];
    expect(ordered.map((b) => b.textContent)).toEqual(["Anthropic", "OpenRouter", "Cancel"]);
    for (const button of ordered) {
      typeMarker();
      const input = keyInput();
      fireEvent.click(button);
      expect(input.value).toBe("");
    }

    // The disabled Save key button does nothing either.
    openNewKeyForm();
    typeMarker();
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    fireEvent.submit(screen.getByRole("form", { name: "AI provider key" }));
    expect(keyInput().value).toBe("");

    // Then every enabled button on the page (Change, Remove key, dialog buttons included).
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    choosePreviewState("working");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    typeMarker();
    for (const button of enabledButtons()) {
      if (!button.isConnected) continue;
      act(() => {
        fireEvent.click(button);
      });
    }

    assertNoLeak(container);
  });
});

describe("Integrations page: password manager safety (R2eu-1)", () => {
  const MARKER = "sk-or-v1-PREVIEWMARKER0123456789abcdef";

  it("the key input carries the no-save attributes", () => {
    renderPage();
    openNewKeyForm();
    const input = keyInput();
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-1p-ignore");
    expect(input).toHaveAttribute("data-lpignore", "true");
    expect(input).toHaveAttribute("data-bwignore");
    expect(input).toHaveAttribute("data-form-type", "other");
  });

  it("empties the input when a preview state change removes the form", () => {
    renderPage();
    openNewKeyForm();
    const input = keyInput();
    fireEvent.change(input, { target: { value: MARKER } });
    choosePreviewState("working");
    expect(input.isConnected).toBe(false);
    expect(input.value).toBe("");
  });

  it("empties the input when the page unmounts (navigation)", () => {
    const { unmount } = renderPage();
    openNewKeyForm();
    const input = keyInput();
    fireEvent.change(input, { target: { value: MARKER } });
    unmount();
    expect(input.value).toBe("");
  });
});

describe("Integrations page: keyboard and labels (j)", () => {
  it("the provider picker is a radio group with arrow-key navigation and one tab stop", () => {
    renderPage();
    openNewKeyForm();
    const group = screen.getByRole("radiogroup", { name: "Provider" });
    const openRouter = within(group).getByRole("radio", { name: "OpenRouter" });
    const anthropic = within(group).getByRole("radio", { name: "Anthropic" });
    expect(openRouter).toHaveAttribute("tabindex", "0");
    expect(anthropic).toHaveAttribute("tabindex", "-1");

    openRouter.focus();
    fireEvent.keyDown(openRouter, { key: "ArrowRight" });
    expect(anthropic).toHaveAttribute("aria-checked", "true");
    expect(anthropic).toHaveFocus();
    expect(anthropic).toHaveAttribute("tabindex", "0");
    expect(keyInput()).toHaveAccessibleName("Anthropic API key");

    fireEvent.keyDown(anthropic, { key: "ArrowRight" });
    expect(openRouter).toHaveAttribute("aria-checked", "true");
    expect(openRouter).toHaveFocus();

    fireEvent.keyDown(openRouter, { key: "ArrowLeft" });
    expect(anthropic).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(anthropic, { key: "ArrowUp" });
    expect(openRouter).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(openRouter, { key: "End" });
    expect(anthropic).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(anthropic, { key: "Home" });
    expect(openRouter).toHaveAttribute("aria-checked", "true");
  });

  it("the remove dialog closes on Escape", async () => {
    renderPage();
    choosePreviewState("saved");
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("sk-or-…4f2a")).toBeInTheDocument();
  });

  it("every input and select has a label", () => {
    renderPage();
    openNewKeyForm();
    const controls = Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"));
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const control of controls) {
      expect(control).toHaveAccessibleName();
    }
    expect(keyInput()).toHaveAttribute("autocomplete", "off");
    expect(keyInput()).toHaveAttribute("spellcheck", "false");
    expect(keyInput()).not.toHaveAttribute("name");
  });
});
