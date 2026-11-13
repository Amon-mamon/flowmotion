// @vitest-environment node
/**
 * Route-level tests for the security-sensitive handlers: webhook signature
 * gate and the installation callback state check. External effects (Supabase,
 * GitHub, rate limiter) are mocked; the handlers' own logic is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  APP_URL: "https://app.example.com",
  GITHUB_WEBHOOK_SECRET: "whsec-test",
  GITHUB_APP_CLIENT_ID: "Iv1.id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_SLUG: "flow-motion-dev",
}));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => env }));

type InstallationAccess = {
  installationId: number;
  accountLogin: string;
  repos: { id: number; fullName: string; private: boolean; defaultBranch: string }[];
};
type AccessSync = {
  user: { id: number; login: string };
  installations: InstallationAccess[];
  droppedRepos: number;
  truncatedRepos: number;
};
const {
  deleteByGitHubId,
  revokeRepos,
  linkInstallations,
  sessionUser,
  resolveAccess,
  audit,
  handlePush,
  ipLimit,
} = vi.hoisted(() => ({
  deleteByGitHubId: vi.fn<(id: number) => Promise<number>>(async () => 1),
  revokeRepos: vi.fn<(id: number, repoIds: readonly number[]) => Promise<number>>(async () => 1),
  linkInstallations: vi.fn<
    (input: {
      userId: string;
      githubUserId: number;
      githubUserLogin: string;
      installations: readonly InstallationAccess[];
    }) => Promise<number[]>
  >(async (input) => input.installations.map((item) => item.installationId)),
  sessionUser: vi.fn<() => Promise<{ id: string; email: string } | null>>(),
  resolveAccess: vi.fn<(input: { code: string }) => Promise<AccessSync>>(),
  audit: vi.fn(async () => undefined),
  handlePush: vi.fn(async () => 0),
  ipLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/installations", async (importOriginal) => ({
  GitHubAccountMismatchError: (await importOriginal<typeof import("@/server/installations")>())
    .GitHubAccountMismatchError,
  deleteInstallationsByGitHubId: deleteByGitHubId,
  revokeInstallationRepos: revokeRepos,
  linkGithubInstallations: linkInstallations,
}));
vi.mock("@/server/github/push", () => ({ handlePushEvent: handlePush }));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceIpLimit: ipLimit,
  enforceUserLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ audit }));

vi.mock("@/server/auth", () => ({
  getSessionUser: () => sessionUser(),
  requireUser: async () => {
    const user = await sessionUser();
    if (user === null) throw new Error("unauth");
    return user;
  },
  requireSameOrigin: () => undefined,
}));

vi.mock("@/server/github/user-auth", () => ({ resolveUserAccess: resolveAccess }));

import { computeWebhookSignature } from "@/lib/github/webhook-signature";
import { GET as callback } from "@/app/api/github/installations/callback/route";
import { GET as authorize } from "@/app/api/github/authorize/route";
import { GET as install } from "@/app/api/github/install/route";
import { POST as webhook } from "@/app/api/github/webhook/route";
import { GitHubAccountMismatchError } from "@/server/installations";
import { ApiError } from "@/server/http";

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function webhookRequest(event: string, body: unknown, signature?: string | null) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "x-github-event": event, "x-github-delivery": "d-1" };
  const sig = signature === undefined ? await computeWebhookSignature(env.GITHUB_WEBHOOK_SECRET, raw) : signature;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return new Request("https://app.example.com/api/github/webhook", { method: "POST", headers, body: raw });
}

describe("POST /api/github/webhook", () => {
  const deleted = { action: "deleted", installation: { id: 4242 } };

  it("valid signature + installation.deleted removes rows by GitHub id", async () => {
    const response = await webhook(await webhookRequest("installation", deleted), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { received: true } });
    expect(deleteByGitHubId).toHaveBeenCalledWith(4242);
  });

  it("missing signature → 403 FORBIDDEN, nothing deleted", async () => {
    const response = await webhook(await webhookRequest("installation", deleted, null), ctx);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(deleteByGitHubId).not.toHaveBeenCalled();
  });

  it("invalid signature → 403 FORBIDDEN, nothing deleted", async () => {
    const bad = await computeWebhookSignature("wrong-secret", JSON.stringify(deleted));
    const response = await webhook(await webhookRequest("installation", deleted, bad), ctx);
    expect(response.status).toBe(403);
    expect(deleteByGitHubId).not.toHaveBeenCalled();
  });

  it("verifies the raw bytes: non-ASCII and BOM-prefixed bodies (R1-4)", async () => {
    const json = JSON.stringify({ action: "deleted", installation: { id: 99 }, note: "héllo ✓ 日本" });
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json)]);
    const sig = await computeWebhookSignature(env.GITHUB_WEBHOOK_SECRET, bytes);
    const request = new Request("https://app.example.com/api/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "installation", "x-hub-signature-256": sig },
      body: bytes,
    });
    const response = await webhook(request, ctx);
    expect(response.status).toBe(200);
    expect(deleteByGitHubId).toHaveBeenCalledWith(99);

    // Signature of the BOM-less text must not verify the BOM-prefixed bytes.
    const textSig = await computeWebhookSignature(env.GITHUB_WEBHOOK_SECRET, json);
    const tampered = new Request("https://app.example.com/api/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "installation", "x-hub-signature-256": textSig },
      body: bytes,
    });
    expect((await webhook(tampered, ctx)).status).toBe(403);
  });

  it("ignores a foreign Origin header (signature-verified, CSRF-exempt)", async () => {
    const raw = JSON.stringify({ zen: "x" });
    const request = new Request("https://app.example.com/api/github/webhook", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "x-github-event": "ping",
        "x-hub-signature-256": await computeWebhookSignature(env.GITHUB_WEBHOOK_SECRET, raw),
      },
      body: raw,
    });
    expect((await webhook(request, ctx)).status).toBe(200);
  });

  it("other events are acknowledged and ignored", async () => {
    for (const [event, body] of [
      ["installation", { action: "created", installation: { id: 1 } }],
      ["ping", { zen: "x" }],
    ] as const) {
      const response = await webhook(await webhookRequest(event, body), ctx);
      expect(await response.json()).toEqual({ ok: true, data: { received: true } });
    }
    expect(deleteByGitHubId).not.toHaveBeenCalled();
    expect(handlePush).not.toHaveBeenCalled();
  });

  it("push â†’ parsed payload handed to the push handler (matching is tested in push.test.ts)", async () => {
    const push = {
      ref: "refs/heads/feature/x",
      after: "a".repeat(40),
      repository: { full_name: "octo/site" },
      installation: { id: 4242 },
    };
    const response = await webhook(await webhookRequest("push", push), ctx);
    expect(await response.json()).toEqual({ ok: true, data: { received: true } });
    expect(handlePush).toHaveBeenCalledWith(push);
  });

  it("push with a malformed payload â†’ 400, nothing updated", async () => {
    const response = await webhook(await webhookRequest("push", { ref: "refs/heads/main" }), ctx);
    expect(response.status).toBe(400);
    expect(handlePush).not.toHaveBeenCalled();
  });
});

describe("POST /api/github/webhook installation_repositories (D-22)", () => {
  it("removed → deletes those repo ids from every user's set for that installation", async () => {
    const body = {
      action: "removed",
      installation: { id: 4242 },
      repositories_removed: [{ id: 11, full_name: "octo/a" }, { id: 12, full_name: "octo/b" }],
    };
    const response = await webhook(await webhookRequest("installation_repositories", body), ctx);
    expect(await response.json()).toEqual({ ok: true, data: { received: true } });
    expect(revokeRepos).toHaveBeenCalledWith(4242, [11, 12]);
  });

  it("added → nothing changes until each user refreshes", async () => {
    const body = {
      action: "added",
      installation: { id: 4242 },
      repositories_added: [{ id: 13, full_name: "octo/c" }],
    };
    const response = await webhook(await webhookRequest("installation_repositories", body), ctx);
    expect(response.status).toBe(200);
    expect(revokeRepos).not.toHaveBeenCalled();
  });

  it("bad signature → 403, nothing revoked", async () => {
    const body = { action: "removed", installation: { id: 4242 }, repositories_removed: [{ id: 11 }] };
    const response = await webhook(await webhookRequest("installation_repositories", body, "sha256=" + "0".repeat(64)), ctx);
    expect(response.status).toBe(403);
    expect(revokeRepos).not.toHaveBeenCalled();
  });
});

describe("GET /api/github/authorize", () => {
  it("sets fm_gh_state and redirects to GitHub App user authorization with our callback", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    const response = await authorize(new Request("https://app.example.com/api/github/authorize"), ctx);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("Iv1.id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/github/installations/callback",
    );
    expect(location.searchParams.get("scope")).toBeNull();
    const state = location.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`fm_gh_state=u1.${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=600/i);
  });

  it("S11-3: Sec-Fetch-Site cross-site → /dashboard?error=github, no cookie", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    const response = await authorize(
      new Request("https://app.example.com/api/github/authorize", { headers: { "sec-fetch-site": "cross-site" } }),
      ctx,
    );
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("same-origin and same-site navigations are allowed", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    for (const site of ["same-origin", "same-site", "none"]) {
      const response = await authorize(
        new Request("https://app.example.com/api/github/authorize", { headers: { "sec-fetch-site": site } }),
        ctx,
      );
      expect(new URL(response.headers.get("location") ?? "").host).toBe("github.com");
    }
  });

  it("S11-5: rate limited → /dashboard?error=github, never JSON", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    ipLimit.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));
    const response = await authorize(new Request("https://app.example.com/api/github/authorize"), ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("redirects to /login without a session, no cookie", async () => {
    sessionUser.mockResolvedValue(null);
    const response = await authorize(new Request("https://app.example.com/api/github/authorize"), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/github/install", () => {
  it("redirects to the GitHub install page and sets fm_gh_state", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    const response = await install(new Request("https://app.example.com/api/github/install"), ctx);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://github.com/apps/flow-motion-dev/installations/new",
    );
    const state = location.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`fm_gh_state=u1.${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=600/i);
  });

  it("S11-5: rate limited → /dashboard?error=github, never JSON", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    ipLimit.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));
    const response = await install(new Request("https://app.example.com/api/github/install"), ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
  });

  it("redirects to /login without a session", async () => {
    sessionUser.mockResolvedValue(null);
    const response = await install(new Request("https://app.example.com/api/github/install"), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
  });
});

describe("GET /api/github/installations/callback", () => {
  const STATE = "a".repeat(64);
  const COOKIE = `u1.${STATE}`;
  const callbackRequest = (query: string, cookieState: string | null) =>
    new Request(`https://app.example.com/api/github/installations/callback?${query}`, {
      headers: cookieState === null ? {} : { cookie: `other=1; fm_gh_state=${cookieState}` },
    });
  const goodQuery = `installation_id=77&setup_action=install&state=${STATE}&code=abc`;
  const cleared = (response: Response) =>
    expect(response.headers.get("set-cookie") ?? "").toMatch(/fm_gh_state=;.*Max-Age=0/i);
  const repo = (id: number, fullName: string) => ({ id, fullName, private: true, defaultBranch: "main" });
  const sync = (installations: InstallationAccess[]): AccessSync => ({
    user: { id: 9001, login: "octocat" },
    installations,
    droppedRepos: 0,
    truncatedRepos: 0,
  });

  beforeEach(() => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
  });

  it("no state (installed directly on GitHub) → /dashboard?link=github, nothing exchanged or written (S11-3)", async () => {
    const response = await callback(callbackRequest("installation_id=77&setup_action=install&code=abc", COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?link=github");
    expect(resolveAccess).not.toHaveBeenCalled();
    expect(linkInstallations).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    cleared(response);
  });

  it("no state and no code → /dashboard?link=github", async () => {
    const response = await callback(callbackRequest("", null), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?link=github");
    expect(resolveAccess).not.toHaveBeenCalled();
    cleared(response);
  });

  it("empty state → treated as no state, never bound", async () => {
    const response = await callback(callbackRequest("state=&code=abc&installation_id=77", COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?link=github");
    expect(linkInstallations).not.toHaveBeenCalled();
  });

  it("state mismatch → /dashboard?error=github, no GitHub call, cookie cleared", async () => {
    const response = await callback(callbackRequest(goodQuery, `u1.${"b".repeat(64)}`), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(resolveAccess).not.toHaveBeenCalled();
    expect(linkInstallations).not.toHaveBeenCalled();
    cleared(response);
  });

  it("missing state cookie → error redirect", async () => {
    const response = await callback(callbackRequest(goodQuery, null), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(resolveAccess).not.toHaveBeenCalled();
    cleared(response);
  });

  it("installation_id not in the user's installations → error redirect, nothing stored", async () => {
    resolveAccess.mockResolvedValue(sync([{ installationId: 5, accountLogin: "someone", repos: [] }]));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(linkInstallations).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    cleared(response);
  });

  it("GitHub failure → error redirect", async () => {
    resolveAccess.mockRejectedValue(new Error("boom"));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(linkInstallations).not.toHaveBeenCalled();
    cleared(response);
  });

  it("bad query (state without code) → error redirect", async () => {
    const response = await callback(callbackRequest(`state=${STATE}`, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    cleared(response);
  });

  it("valid state → links every installation with its repo set and the GitHub user, audits, connected=1", async () => {
    const installations = [
      { installationId: 77, accountLogin: "octo", repos: [repo(1, "octo/a")] },
      { installationId: 88, accountLogin: "octo-org", repos: [repo(2, "octo-org/b"), repo(3, "octo-org/c")] },
    ];
    resolveAccess.mockResolvedValue(sync(installations));
    linkInstallations.mockResolvedValueOnce([88]);
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(resolveAccess).toHaveBeenCalledWith(expect.objectContaining({ code: "abc" }));
    expect(linkInstallations).toHaveBeenCalledWith({
      userId: "u1",
      githubUserId: 9001,
      githubUserLogin: "octocat",
      installations,
    });
    expect(audit).toHaveBeenCalledWith("u1", "github.connect", "88");
    expect(audit).toHaveBeenCalledWith("u1", "github.sync", "2");
    expect(audit).toHaveBeenCalledTimes(2);
    cleared(response);
  });

  it("valid state without installation_id (authorize / refresh) → links all listed", async () => {
    const installations = [{ installationId: 77, accountLogin: "octo", repos: [repo(1, "octo/a")] }];
    resolveAccess.mockResolvedValue(sync(installations));
    const response = await callback(callbackRequest(`state=${STATE}&code=abc`, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(linkInstallations).toHaveBeenCalledWith(expect.objectContaining({ installations }));
  });

  it("no installations → link called with [] (clears the sets), /dashboard?error=github_none", async () => {
    resolveAccess.mockResolvedValue(sync([]));
    const response = await callback(callbackRequest(`state=${STATE}&code=abc`, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_none");
    expect(linkInstallations).toHaveBeenCalledWith(expect.objectContaining({ installations: [] }));
    cleared(response);
  });

  it("different GitHub account than the one linked → ?error=github_account, nothing audited", async () => {
    resolveAccess.mockResolvedValue(sync([{ installationId: 77, accountLogin: "octo", repos: [] }]));
    linkInstallations.mockRejectedValueOnce(new GitHubAccountMismatchError());
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_account");
    expect(audit).not.toHaveBeenCalled();
    cleared(response);
  });

  it("never logs anything token-like or repo names", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    resolveAccess.mockResolvedValue(sync([{ installationId: 77, accountLogin: "octo", repos: [repo(1, "octo/secret-repo")] }]));
    await callback(callbackRequest(goodQuery, COOKIE), ctx);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("secret-repo");
    expect(logged).not.toContain("abc");
    expect(logged).not.toMatch(/gh[us]_/);
  });

  it("state cookie started by another Flow Motion user → error redirect (R1-5)", async () => {
    const response = await callback(callbackRequest(goodQuery, `u2.${STATE}`), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("malformed cookie encoding → redirect, never a JSON 500 (R1-5)", async () => {
    const request = new Request(
      `https://app.example.com/api/github/installations/callback?${goodQuery}`,
      { headers: { cookie: `bad=%E0%A4%A; fm_gh_state=%E0%A4%A` } },
    );
    const response = await callback(request, ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    cleared(response);
  });

  it("database failure while linking → error redirect with cookie cleared", async () => {
    resolveAccess.mockResolvedValue(sync([{ installationId: 77, accountLogin: "octo", repos: [] }]));
    linkInstallations.mockRejectedValueOnce(new Error("db"));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    cleared(response);
  });

  it("rate limited → error redirect", async () => {
    ipLimit.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    cleared(response);
  });

  it("signed out → /login and the state cookie is cleared (R11-7)", async () => {
    sessionUser.mockResolvedValue(null);
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
    cleared(response);
    expect(resolveAccess).not.toHaveBeenCalled();
  });
});
