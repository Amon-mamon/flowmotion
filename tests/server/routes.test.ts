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

const { deleteByGitHubId, upsertInstallation, sessionUser, verifyOwnership } = vi.hoisted(() => ({
  deleteByGitHubId: vi.fn<(id: number) => Promise<number>>(async () => 1),
  upsertInstallation: vi.fn<
    (input: { userId: string; installationId: number; accountLogin: string }) => Promise<{ id: string }>
  >(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  sessionUser: vi.fn<() => Promise<{ id: string; email: string } | null>>(),
  verifyOwnership: vi.fn(),
}));
vi.mock("@/server/installations", () => ({
  deleteInstallationsByGitHubId: deleteByGitHubId,
  upsertInstallation,
}));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceIpLimit: vi.fn(async () => undefined),
  enforceUserLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/auth", () => ({
  getSessionUser: () => sessionUser(),
  requireUser: async () => {
    const user = await sessionUser();
    if (user === null) throw new Error("unauth");
    return user;
  },
  requireSameOrigin: () => undefined,
}));

vi.mock("@/server/github/user-auth", () => ({ verifyInstallationOwnership: verifyOwnership }));

import { computeWebhookSignature } from "@/lib/github/webhook-signature";
import { GET as callback } from "@/app/api/github/installations/callback/route";
import { GET as install } from "@/app/api/github/install/route";
import { POST as webhook } from "@/app/api/github/webhook/route";

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
      ["push", { ref: "refs/heads/main" }],
      ["installation", { action: "created", installation: { id: 1 } }],
      ["ping", { zen: "x" }],
    ] as const) {
      const response = await webhook(await webhookRequest(event, body), ctx);
      expect(await response.json()).toEqual({ ok: true, data: { received: true } });
    }
    expect(deleteByGitHubId).not.toHaveBeenCalled();
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

  beforeEach(() => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
  });

  it("state mismatch → /dashboard?error=github, no GitHub call, cookie cleared", async () => {
    const response = await callback(callbackRequest(goodQuery, `u1.${"b".repeat(64)}`), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(verifyOwnership).not.toHaveBeenCalled();
    expect(upsertInstallation).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie") ?? "").toMatch(/fm_gh_state=;.*Max-Age=0/i);
  });

  it("missing state cookie → error redirect", async () => {
    const response = await callback(callbackRequest(goodQuery, null), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(verifyOwnership).not.toHaveBeenCalled();
  });

  it("installation not owned by the GitHub user → error redirect, nothing stored", async () => {
    verifyOwnership.mockResolvedValue(null);
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(upsertInstallation).not.toHaveBeenCalled();
  });

  it("GitHub failure → error redirect", async () => {
    verifyOwnership.mockRejectedValue(new Error("boom"));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
  });

  it("bad query → error redirect", async () => {
    const response = await callback(callbackRequest(`state=${STATE}`, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
  });

  it("valid state + ownership → upsert and /dashboard?connected=1", async () => {
    verifyOwnership.mockResolvedValue({ accountLogin: "octo" });
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(verifyOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", installationId: 77 }),
    );
    expect(upsertInstallation).toHaveBeenCalledWith({ userId: "u1", installationId: 77, accountLogin: "octo" });
  });

  it("state cookie started by another Flow Motion user → error redirect (R1-5)", async () => {
    const response = await callback(callbackRequest(goodQuery, `u2.${STATE}`), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(verifyOwnership).not.toHaveBeenCalled();
  });

  it("malformed cookie encoding → redirect, never a JSON 500 (R1-5)", async () => {
    const request = new Request(
      `https://app.example.com/api/github/installations/callback?${goodQuery}`,
      { headers: { cookie: `bad=%E0%A4%A; fm_gh_state=%E0%A4%A` } },
    );
    const response = await callback(request, ctx);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(response.headers.get("set-cookie") ?? "").toMatch(/fm_gh_state=;.*Max-Age=0/i);
  });

  it("database failure after ownership → error redirect with cookie cleared", async () => {
    verifyOwnership.mockResolvedValue({ accountLogin: "octo" });
    upsertInstallation.mockRejectedValueOnce(new Error("db"));
    const response = await callback(callbackRequest(goodQuery, COOKIE), ctx);
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(response.headers.get("set-cookie") ?? "").toMatch(/fm_gh_state=;.*Max-Age=0/i);
  });
});
