import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("test runner", () => {
  it("renders the placeholder page", () => {
    render(<Home />);
    expect(screen.getByText("Flow Motion")).toBeInTheDocument();
  });
});
