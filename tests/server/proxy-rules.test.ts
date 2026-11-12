import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PROXY_MATCHER, decideProxy, isAppPath } from "@/server/proxy-rules";

const unauth = (pathname: string) => decideProxy({ pathname, isAuthenticated: false });
const auth = (pathname: string) => decideProxy({ pathname, isAuthenticated: true });

describe("proxy rules (contract section 3)", () => {
  it("marketing pages are never redirected", () => {
    for (const path of ["/", "/privacy", "/terms", "/unknown-page"]) {
      expect(unauth(path)).toEqual({ kind: "next" });
      expect(auth(path)).toEqual({ kind: "next" });
    }
  });

  it("app pages send unauthenticated users to /login", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/",
      "/projects/abc",
      "/projects/abc/analysis/def",
      "/flows/xyz",
      "/settings",
    ]) {
      expect(unauth(path)).toEqual({ kind: "redirect", to: "/login" });
      expect(auth(path)).toEqual({ kind: "next" });
    }
  });

  it("does not treat look-alike prefixes as app pages", () => {
    expect(isAppPath("/dashboards")).toBe(false);
    expect(isAppPath("/settingsx")).toBe(false);
    expect(unauth("/projectsfoo")).toEqual({ kind: "next" });
  });

  it("authenticated users visiting /login or /signup go to /dashboard", () => {
    expect(auth("/login")).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(auth("/signup")).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(unauth("/login")).toEqual({ kind: "next" });
    expect(unauth("/signup")).toEqual({ kind: "next" });
  });

  it("/api/* returns 401 JSON instead of redirecting", () => {
    for (const path of ["/api/projects", "/api/profile", "/api/github/installations", "/api"]) {
      expect(unauth(path)).toEqual({ kind: "unauthorized" });
      expect(auth(path)).toEqual({ kind: "next" });
    }
  });

  it("browser-navigated GitHub routes redirect to /login", () => {
    expect(unauth("/api/github/install")).toEqual({ kind: "redirect", to: "/login" });
    expect(unauth("/api/github/installations/callback")).toEqual({
      kind: "redirect",
      to: "/login",
    });
    expect(auth("/api/github/install")).toEqual({ kind: "next" });
  });

  it("sessionless routes are never checked", () => {
    for (const path of ["/api/auth/callback", "/api/github/webhook"]) {
      expect(unauth(path)).toEqual({ kind: "next" });
      expect(auth(path)).toEqual({ kind: "next" });
    }
  });

  it("matcher excludes _next/static, _next/image, favicon.ico and files with an extension", () => {
    const re = new RegExp(`^${PROXY_MATCHER}$`);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/api/projects")).toBe(true);
    expect(re.test("/")).toBe(true);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/_next/image?url=x")).toBe(false);
    expect(re.test("/favicon.ico")).toBe(false);
    expect(re.test("/logo.svg")).toBe(false);
    expect(re.test("/fonts/geist.woff2")).toBe(false);
  });

  it("src/proxy.ts config.matcher literal equals PROXY_MATCHER", () => {
    const source = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
    const match = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(source);
    expect(match?.[1]).toBeDefined();
    expect(JSON.parse(`"${match?.[1] ?? ""}"`)).toBe(PROXY_MATCHER);
  });
});
