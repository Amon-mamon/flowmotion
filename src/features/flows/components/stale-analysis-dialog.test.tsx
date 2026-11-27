import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaleAnalysisDialog } from "@/features/flows/components/stale-analysis-dialog";

const TITLE = "This analysis is out of date";
const PREFIX = "New commits were pushed after this analysis. The flow would be built from the analyzed commit";
const SHA = "0123456789abcdef0123456789abcdef01234567";

function setup(commitSha: string | null = SHA) {
  const onOpenChange = vi.fn();
  const onGenerateAnyway = vi.fn();
  render(
    <StaleAnalysisDialog
      open
      onOpenChange={onOpenChange}
      projectId="p 1"
      analysisCommitSha={commitSha}
      onGenerateAnyway={onGenerateAnyway}
    />,
  );
  return { onOpenChange, onGenerateAnyway, dialog: screen.getByRole("alertdialog") };
}

describe("StaleAnalysisDialog (design.md PROJECT_STALE_ANALYSIS)", () => {
  it("is labelled by its title and shows the body with the 7-character sha in mono", () => {
    const { dialog } = setup();
    expect(dialog).toHaveAccessibleName(TITLE);
    expect(within(dialog).getByRole("heading", { name: TITLE })).toBeInTheDocument();
    const sha = within(dialog).getByText("0123456");
    expect(sha).toHaveClass("font-mono");
    expect(dialog.textContent).toContain(`${PREFIX} 0123456.`);
    expect(dialog.textContent).not.toContain(SHA);
  });

  it("without a sha the body ends at the analyzed commit", () => {
    const { dialog } = setup(null);
    expect(within(dialog).getByText(`${PREFIX}.`)).toBeInTheDocument();
  });

  it("Generate anyway calls back; Re-analyze links to the project page", () => {
    const { dialog, onGenerateAnyway } = setup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate anyway" }));
    expect(onGenerateAnyway).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("link", { name: "Re-analyze" })).toHaveAttribute("href", "/projects/p%201");
  });

  it("Esc asks to close without generating", async () => {
    const { dialog, onOpenChange, onGenerateAnyway } = setup();
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(onGenerateAnyway).not.toHaveBeenCalled();
  });

  it("disables Generate anyway while a request is pending", () => {
    const onGenerateAnyway = vi.fn();
    render(
      <StaleAnalysisDialog
        open
        onOpenChange={vi.fn()}
        projectId="p"
        analysisCommitSha={SHA}
        onGenerateAnyway={onGenerateAnyway}
        pending
      />,
    );
    const button = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Generate anyway" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onGenerateAnyway).not.toHaveBeenCalled();
  });

  it("keeps the sha literal text", () => {
    const { dialog } = setup("<b>xyz</b>abc");
    expect(within(dialog).getByText("<b>xyz<")).toBeInTheDocument();
    expect(dialog.querySelector("b")).toBeNull();
  });
});
