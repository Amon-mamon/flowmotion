// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  GH_STATE_COOKIE,
  GH_STATE_MAX_AGE_SECONDS,
  encodeStateCookie,
  generateInstallState,
  readCookie,
  stateCookieOptions,
  verifyInstallState,
} from "@/server/github/state";

describe("GitHub install state", () => {
  it("generates 32 random bytes as hex, unique per call", () => {
    const a = generateInstallState();
    const b = generateInstallState();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("cookie is httpOnly, sameSite=lax, 10 minutes, secure on https", () => {
    expect(GH_STATE_COOKIE).toBe("fm_gh_state");
    expect(GH_STATE_MAX_AGE_SECONDS).toBe(600);
    expect(stateCookieOptions("https://app.example.com")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    expect(stateCookieOptions("http://localhost:3000").secure).toBe(false);
    expect(stateCookieOptions("garbage").secure).toBe(true);
  });

  const USER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";

  it("verifies state and user binding, rejecting any mismatch or missing value", () => {
    const state = generateInstallState();
    const cookie = encodeStateCookie(USER, state);
    expect(cookie).toBe(`${USER}.${state}`);
    expect(verifyInstallState(state, cookie, USER)).toBe(true);
    // Different signed-in user on the same browser (review R1-5).
    expect(verifyInstallState(state, cookie, OTHER)).toBe(false);
    expect(verifyInstallState(state.slice(0, -1) + "0", cookie, USER)).toBe(false);
    expect(verifyInstallState(state, `${USER}.${state}x`, USER)).toBe(false);
    expect(verifyInstallState(state, state, USER)).toBe(false); // no user part
    expect(verifyInstallState(state, `${USER}.`, USER)).toBe(false);
    expect(verifyInstallState(state, `.${state}`, USER)).toBe(false);
    expect(verifyInstallState(state, null, USER)).toBe(false);
    expect(verifyInstallState(null, cookie, USER)).toBe(false);
    expect(verifyInstallState("", cookie, USER)).toBe(false);
    expect(verifyInstallState(state, cookie, "")).toBe(false);
  });

  it("readCookie never throws on malformed headers and does not decode", () => {
    expect(readCookie("a=1; fm_gh_state=u.abc; b=%E0%A4%A", "fm_gh_state")).toBe("u.abc");
    expect(readCookie("fm_gh_state=%E0%A4%A", "fm_gh_state")).toBe("%E0%A4%A");
    expect(readCookie("garbage;;=;x", "fm_gh_state")).toBeNull();
    expect(readCookie("", "fm_gh_state")).toBeNull();
    expect(readCookie(null, "fm_gh_state")).toBeNull();
    expect(readCookie("xfm_gh_state=1", "fm_gh_state")).toBeNull();
  });
});
