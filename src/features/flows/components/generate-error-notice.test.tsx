import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/features/api/client";
import { GenerateErrorNotice } from "@/features/flows/components/generate-error-notice";

const GENERIC = "Could not start generation. Try again.";
const notice = () => document.querySelector("[data-notice]")?.getAttribute("data-notice");

describe("GenerateErrorNotice (design.md Card action area)", () => {
  it("VALIDATION_ERROR shows the server message as plain text", () => {
    render(<GenerateErrorNotice error={new ApiError("VALIDATION_ERROR", "A flow already exists for this recommendation.", 400)} />);
    expect(screen.getByText("A flow already exists for this recommendation.")).toBeInTheDocument();
    expect(notice()).toBe("generate-validation");
  });

  it("a server message with markup renders literally", () => {
    render(<GenerateErrorNotice error={new ApiError("VALIDATION_ERROR", "<b>x</b>", 400)} />);
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("VALIDATION_ERROR with an empty message falls back to the generic copy", () => {
    render(<GenerateErrorNotice error={new ApiError("VALIDATION_ERROR", "", 400)} />);
    expect(screen.getByText(GENERIC)).toBeInTheDocument();
    expect(notice()).toBe("generate-error");
  });

  it("DAILY_CAP_REACHED shows the generation daily cap", () => {
    render(<GenerateErrorNotice error={new ApiError("DAILY_CAP_REACHED", "server text", 429)} />);
    expect(screen.getByText("Daily limit reached (30 flows per day). It resets at 00:00 UTC.")).toBeInTheDocument();
    expect(screen.queryByText("server text")).not.toBeInTheDocument();
    expect(notice()).toBe("generate-daily-cap");
  });

  it("GITHUB_REFRESH_REQUIRED shows the shared refresh notice and action", () => {
    render(<GenerateErrorNotice error={new ApiError("GITHUB_REFRESH_REQUIRED", "x", 403)} />);
    expect(
      screen.getByText(
        "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
    expect(notice()).toBe("refresh-access");
  });

  it("RATE_LIMITED shows the shared copy", () => {
    render(<GenerateErrorNotice error={new ApiError("RATE_LIMITED", "x", 429)} />);
    expect(screen.getByText("Too many requests, try again in a minute")).toBeInTheDocument();
    expect(notice()).toBe("generate-rate-limited");
  });

  it("anything else shows the generic copy", () => {
    for (const error of [
      new ApiError("INTERNAL", "boom", 500),
      new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0),
      new ApiError("UNAUTHORIZED", "no", 401),
      new Error("plain"),
      "string",
    ]) {
      const { unmount } = render(<GenerateErrorNotice error={error} />);
      expect(screen.getByText(GENERIC)).toBeInTheDocument();
      expect(notice()).toBe("generate-error");
      unmount();
    }
  });

  it("PROJECT_STALE_ANALYSIS shows no notice (the dialog handles it)", () => {
    const { container } = render(<GenerateErrorNotice error={new ApiError("PROJECT_STALE_ANALYSIS", "stale", 409)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("each variant has a distinct data-notice value", () => {
    const values = new Set<string | null | undefined>();
    for (const error of [
      new ApiError("VALIDATION_ERROR", "m", 400),
      new ApiError("DAILY_CAP_REACHED", "m", 429),
      new ApiError("GITHUB_REFRESH_REQUIRED", "m", 403),
      new ApiError("RATE_LIMITED", "m", 429),
      new ApiError("INTERNAL", "m", 500),
    ]) {
      const { unmount } = render(<GenerateErrorNotice error={error} />);
      values.add(notice());
      unmount();
    }
    expect(values.size).toBe(5);
  });
});
