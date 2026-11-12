import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

const signInWithPassword = vi.fn();
const signUp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp } }),
}));

import { LoginForm } from "@/features/auth/components/login-form";
import { SignupForm } from "@/features/auth/components/signup-form";

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  signInWithPassword.mockReset();
  signUp.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("LoginForm", () => {
  it("rejects a bad email without calling Supabase", async () => {
    render(<LoginForm />);
    fill(/^email$/i, "not-an-email");
    fill(/^password$/i, "whatever");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("requires a password", async () => {
    render(<LoginForm />);
    fill(/^email$/i, "jane@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Enter your password")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("calls signInWithPassword and goes to /dashboard", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    render(<LoginForm />);
    fill(/^email$/i, " jane@example.com ");
    fill(/^password$/i, "correct-horse");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({ email: "jane@example.com", password: "correct-horse" }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows the generic error on failure", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: "User not found" } });
    render(<LoginForm />);
    fill(/^email$/i, "jane@example.com");
    fill(/^password$/i, "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(screen.queryByText("User not found")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SignupForm", () => {
  it("rejects a short password", async () => {
    render(<SignupForm />);
    fill(/^email$/i, "jane@example.com");
    fill(/^password$/i, "short");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a display name over 80 characters", async () => {
    render(<SignupForm />);
    fill(/^email$/i, "jane@example.com");
    fill(/^password$/i, "long-enough-pw");
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "x".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Display name must be 80 characters or fewer")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("passes display_name and shows the confirm-email state when no session", async () => {
    signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null });
    render(<SignupForm />);
    fill(/^email$/i, "jane@example.com");
    fill(/^password$/i, "long-enough-pw");
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "  Jane  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Check your email to confirm your account")).toBeInTheDocument();
    const call = signUp.mock.calls[0]?.[0] as { options: { data?: Record<string, string> } };
    expect(call.options.data).toEqual({ display_name: "Jane" });
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to /dashboard when a session is returned", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "t" }, user: {} }, error: null });
    render(<SignupForm />);
    fill(/^email$/i, "jane@example.com");
    fill(/^password$/i, "long-enough-pw");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    const call = signUp.mock.calls[0]?.[0] as { options: { data?: unknown } };
    expect(call.options.data).toBeUndefined();
  });
});
