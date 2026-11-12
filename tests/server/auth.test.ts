// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ APP_URL: "https://app.example.com" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { getSessionUser, requireSameOrigin, requireUser } from "@/server/auth";
import { ApiError } from "@/server/http";

const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  getUser.mockReset();
});

describe("requireUser", () => {
  it("returns { id, email } for a valid session", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "a@example.com" } }, error: null });
    await expect(requireUser()).resolves.toEqual({ id: USER_ID, email: "a@example.com" });
  });

  it("uses an empty email when the auth user has none", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    await expect(requireUser()).resolves.toEqual({ id: USER_ID, email: "" });
  });

  it("throws UNAUTHORIZED 401 without a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const error = await requireUser().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("throws UNAUTHORIZED when Supabase reports an auth error, even with a user object", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "a@example.com" } },
      error: { name: "AuthApiError", status: 401 },
    });
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(getSessionUser()).resolves.toBeNull();
  });
});

describe("requireSameOrigin", () => {
  const request = (method: string, origin?: string) =>
    new Request("https://app.example.com/api/projects", {
      method,
      headers: origin === undefined ? {} : { origin },
    });

  it("throws FORBIDDEN 403 for a foreign Origin on state-changing methods", () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(() => requireSameOrigin(request(method, "https://evil.example"))).toThrow(
        expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
      );
    }
  });

  it("allows the APP_URL origin and a missing Origin", () => {
    expect(() => requireSameOrigin(request("POST", "https://app.example.com"))).not.toThrow();
    expect(() => requireSameOrigin(request("POST"))).not.toThrow();
  });
});
