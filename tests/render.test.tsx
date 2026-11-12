import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/(marketing)/page";

describe("test runner", () => {
  it("renders the landing page", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
