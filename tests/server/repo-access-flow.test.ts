// @vitest-environment node
/**
 * End-to-end route chain for D-22 (S11-1) with GitHub mocked at the fetch
 * level and Supabase replaced by the in-memory fake (helpers/fake-supabase,
 * which mirrors link_github_installations()). Real route handlers, real
 * user-auth, repo-access, installations and client code run:
 *   authorize → callback (GET /user, /user/installations, per-installation
 *   repositories) → link → installations list → repos list → branches →
 *   POST /api/projects; then a refresh replaces the set and an account switch
 *   binds nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = await vi.hoisted(async () => await import("./helpers/fake-supabase"));
const h = vi.hoisted(() => ({
  db: null as null | import("./helpers/fake-supabase").FakeDb,
  createProject: vi.fn(),
  audit: vi.fn(async () => undefined),
  sessionUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    APP_URL: "https://app.example.com",
    GITHUB_APP_CLIENT_ID: "Iv1.client",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.sessionUserId, email: "a@example.com" } }, error: null }) },
    from: (table: string) => fake.fakeFrom(h.db as import("./helpers/fake-supabase").FakeDb)(table),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Parameters<typeof fake.fakeLink>[1]) => {
      if (name !== "link_github_installations") throw new Error(`unexpected rpc ${name}`);
      return fake.fakeLink(h.db as import("./helpers/fake-supabase").FakeDb, args);
    },
  }),
}));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceIpLimit: vi.fn(async () => undefined),
  enforceUserLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ audit: h.audit }));
vi.mock("@/server/github/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/github/app")>()),
  mintInstallationToken: async () => ({ token: "ghs_installation", expiresAt: "2026-11-13T12:00:00Z" }),
  repoInstallationId: async () => 77,
}));
vi.mock("@/server/projects", () => ({
  createProject: h.createProject,
  listProjectsForUser: vi.fn(async () => []),
}));

import { GET as authorize } from "@/app/api/github/authorize/route";
import { GET as listBranches } from "@/app/api/github/installations/[id]/branches/route";
import { GET as callback } from "@/app/api/github/installations/callback/route";
import { GET as listRepos } from "@/app/api/github/installations/[id]/repos/route";
import { GET as listInstallations } from "@/app/api/github/installations/route";
import { POST as createProjectRoute } from "@/app/api/projects/route";

const SHA = "e".repeat(40);
const USER_TOKEN = "ghu_ONE_TIME_TOKEN_never_logged";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noParams = { params: Promise.resolve({}) };

interface GitHubWorld {
  userId: number;
  /** GET /user/installations items (raw, as GitHub sends them). */
  installations: unknown[];
  accessible: { id: number; full_name: string; private: boolean; default_branch: string }[];
}
let world: GitHubWorld;
const calls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function githubFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
    return Promise.resolve(json({ access_token: USER_TOKEN, token_type: "bearer" }));
  }
  if (url.host !== "api.github.com") throw new Error(`unexpected host ${url.host}`);
  if (url.pathname.startsWith("/user")) expect(auth).toBe(`Bearer ${USER_TOKEN}`);
  if (url.pathname === "/user") return Promise.resolve(json({ id: world.userId, login: "octocat" }));
  if (url.pathname === "/user/installations") {
    return Promise.resolve(json({ total_count: world.installations.length, installations: world.installations }));
  }
  if (url.pathname === "/user/installations/77/repositories") {
    return Promise.resolve(json({ total_count: world.accessible.length, repositories: world.accessible }));
  }
  const repoMatch = /^\/repos\/octo-org\/([^/]+)(\/branches(?:\/(.+))?)?$/.exec(url.pathname);
  if (repoMatch !== null) {
    expect(auth).toBe("Bearer ghs_installation");
    const name = repoMatch[1] ?? "";
    const ids: Record<string, number> = { a: 201, b: 202, c: 203 };
    if (repoMatch[2] === undefined) {
      return Promise.resolve(json({ id: ids[name], full_name: `octo-org/${name}`, default_branch: "main", private: true }));
    }
    if (repoMatch[3] === undefined) {
      return Promise.resolve(json([{ name: "main", protected: true }, { name: "feature/x", protected: false }]));
    }
    return Promise.resolve(json({ name: decodeURIComponent(repoMatch[3]), commit: { sha: SHA } }));
  }
  throw new Error(`unexpected GitHub call ${url.pathname}`);
}

const ORG_77 = { id: 77, account: { id: 7700, login: "octo-org", type: "Organization" } };
const repo = (id: number, name: string) => ({ id, full_name: `octo-org/${name}`, private: true, default_branch: "main" });

async function linkThroughAuthorize(): Promise<Response> {
  const start = await authorize(new Request("https://app.example.com/api/github/authorize"), noParams);
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return callback(
    new Request(`https://app.example.com/api/github/installations/callback?code=abc&state=${state}`, {
      headers: { cookie },
    }),
    noParams,
  );
}

function rowId(): string {
  const row = h.db?.installations.find((item) => item.installation_id === 77);
  if (row === undefined) throw new Error("installation not linked");
  return row.id;
}

beforeEach(() => {
  h.db = fake.createFakeDb();
  calls.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(githubFetch));
  h.sessionUserId = USER;
  world = { userId: 9001, installations: [ORG_77], accessible: [repo(201, "a")] };
  h.createProject.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER,
    installation_id: input.installationRowId,
    repo_full_name: input.repoFullName,
    repo_id: input.repoId,
    default_branch: input.defaultBranch,
    branch: input.branch,
    status: "pending",
    invalid_reason: null,
    detected_kind: null,
    last_commit_sha: null,
    stale: false,
    created_at: "2026-11-13T10:00:00+00:00",
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repo access flow (D-22)", () => {
  it("link → list → branches → create, for the one repo the member can access", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const linked = await linkThroughAuthorize();
    expect(linked.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(calls).toEqual([
      "POST /login/oauth/access_token",
      "GET /user",
      "GET /user/installations",
      "GET /user/installations/77/repositories",
    ]);
    // The one-time token is never stored or logged.
    expect(JSON.stringify(h.db)).not.toContain(USER_TOKEN);
    expect(JSON.stringify(info.mock.calls)).not.toContain(USER_TOKEN);

    const installations = await (await listInstallations(new Request("https://app.example.com/api/github/installations"), noParams)).json();
    expect(installations.data.installations).toEqual([
      expect.objectContaining({ installationId: 77, githubUserLogin: "octocat", needsRefresh: false }),
    ]);

    const id = rowId();
    const repos = await (await listRepos(new Request(`https://app.example.com/api/github/installations/${id}/repos`), ctx(id))).json();
    expect(repos.data).toEqual({ repos: [{ fullName: "octo-org/a", defaultBranch: "main", private: true }], page: 1, hasMore: false });

    const branches = await listBranches(
      new Request(`https://app.example.com/api/github/installations/${id}/branches?repo=octo-org/a`),
      ctx(id),
    );
    expect((await branches.json()).data).toEqual({
      branches: [{ name: "main", protected: true }, { name: "feature/x", protected: false }],
      defaultBranch: "main",
      page: 1,
      hasMore: false,
    });

    const created = await createProjectRoute(
      new Request("https://app.example.com/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.com" },
        body: JSON.stringify({ repoFullName: "octo-org/a", installationId: id, branch: "feature/x" }),
      }),
      noParams,
    );
    expect(created.status).toBe(201);
    expect(h.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: "octo-org/a", repoId: 201, branch: "feature/x" }),
    );
    expect(calls).toContain("GET /repos/octo-org/a/branches/feature/x");
  });

  it("repo b of the same installation is refused with no GitHub call for it", async () => {
    await linkThroughAuthorize();
    const id = rowId();
    calls.length = 0;
    const branches = await listBranches(
      new Request(`https://app.example.com/api/github/installations/${id}/branches?repo=octo-org/b`),
      ctx(id),
    );
    expect(branches.status).toBe(403);
    expect((await branches.json()).error.code).toBe("GITHUB_REFRESH_REQUIRED");
    const created = await createProjectRoute(
      new Request("https://app.example.com/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoFullName: "octo-org/b", installationId: id, branch: "main" }),
      }),
      noParams,
    );
    expect(created.status).toBe(403);
    expect(calls).toEqual([]);
    expect(h.createProject).not.toHaveBeenCalled();
  });

  it("a refresh replaces the set (not a merge)", async () => {
    await linkThroughAuthorize();
    world.accessible = [repo(203, "c")];
    const refreshed = await linkThroughAuthorize();
    expect(refreshed.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(h.db?.repos.map((item) => item.repo_full_name)).toEqual(["octo-org/c"]);
    expect(h.db?.installations).toHaveLength(1);
  });

  it("a different GitHub account binds nothing and keeps the old set", async () => {
    await linkThroughAuthorize();
    const before = JSON.stringify(h.db);
    world.userId = 5555;
    world.accessible = [repo(202, "b"), repo(203, "c")];
    const response = await linkThroughAuthorize();
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_account");
    expect(JSON.stringify(h.db)).toBe(before);
  });

  it("an installation the user no longer sees has its set cleared and needs a refresh", async () => {
    await linkThroughAuthorize();
    const id = rowId();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname === "/user/installations") return Promise.resolve(json({ total_count: 0, installations: [] }));
        return githubFetch(input, init);
      }),
    );
    const response = await linkThroughAuthorize();
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_none");
    expect(h.db?.repos).toEqual([]);
    const repos = await listRepos(new Request(`https://app.example.com/api/github/installations/${id}/repos`), ctx(id));
    expect(repos.status).toBe(403);
  });
});

describe("GitHub account isolation (Phase 1.2: D-43, D-44, D-45)", () => {
  /** Another person's personal installation (type User, account id 2). */
  const OTHER_PERSONAL = { id: 66, account: { id: 2, login: "octocat", type: "User" } };
  const OWN_PERSONAL = { id: 55, account: { id: 9001, login: "octocat", type: "User" } };

  function stubPersonalRepos() {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const match = /^\/user\/installations\/(55|66)\/repositories$/.exec(url.pathname);
        if (match !== null) {
          calls.push(`GET ${url.pathname}`);
          const owner = match[1] === "55" ? "octocat" : "owner-person";
          return Promise.resolve(json({ total_count: 1, repositories: [{ id: Number(match[1]) * 10, full_name: `${owner}/p`, private: true, default_branch: "main" }] }));
        }
        return githubFetch(input, init);
      }),
    );
  }

  it("links own personal + org; another person's personal installation, an enterprise and a malformed item are skipped and their repos never requested", async () => {
    stubPersonalRepos();
    world.installations = [
      OWN_PERSONAL,
      OTHER_PERSONAL,
      ORG_77,
      { id: 88, account: { id: 600, slug: "ent", type: "Enterprise" } },
      { id: "bad" },
    ];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await linkThroughAuthorize();
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(calls).not.toContain("GET /user/installations/66/repositories");
    expect(calls).not.toContain("GET /user/installations/88/repositories");
    expect(h.db?.installations.map((row) => [row.installation_id, row.account_type, row.account_id]).sort()).toEqual([
      [55, "User", 9001],
      [77, "Organization", 7700],
    ]);
    expect(h.db?.repos.some((item) => item.repo_full_name.startsWith("owner-person/"))).toBe(false);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"skipped":3');
    expect(logged).not.toContain("octo-org");
    expect(logged).not.toContain(USER_TOKEN);
  });

  it("only another person's personal installation → link with [] and ?error=github_none", async () => {
    stubPersonalRepos();
    world.installations = [OTHER_PERSONAL];
    const response = await linkThroughAuthorize();
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_none");
    expect(h.db?.installations).toEqual([]);
    expect(calls).not.toContain("GET /user/installations/66/repositories");
  });

  it("installation_id of another person's personal installation → ?error=github, nothing written", async () => {
    stubPersonalRepos();
    world.installations = [OTHER_PERSONAL, ORG_77];
    const start = await authorize(new Request("https://app.example.com/api/github/authorize"), noParams);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const response = await callback(
      new Request(`https://app.example.com/api/github/installations/callback?installation_id=66&setup_action=install&code=abc&state=${state}`, {
        headers: { cookie },
      }),
      noParams,
    );
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?error=github");
    expect(h.db?.installations).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a second Flow Motion account linking a held GitHub account binds nothing → ?error=github_in_use; released after the holder disconnects", async () => {
    await linkThroughAuthorize();
    const before = JSON.stringify(h.db);
    h.sessionUserId = USER_B;
    h.audit.mockClear();
    const inUse = await linkThroughAuthorize();
    expect(inUse.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_in_use");
    expect(JSON.stringify(h.db)).toBe(before);
    expect(h.audit).not.toHaveBeenCalled();
    expect(inUse.headers.get("set-cookie") ?? "").toMatch(/fm_gh_state=;.*Max-Age=0/i);

    // The holder (USER) disconnects every installation.
    fake.deleteInstallationRows(h.db as import("./helpers/fake-supabase").FakeDb, (row) => row.user_id === USER);
    const linked = await linkThroughAuthorize();
    expect(linked.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(h.db?.installations.map((row) => row.user_id)).toEqual([USER_B]);

    // Now USER cannot take it back while USER_B holds it.
    h.sessionUserId = USER;
    const back = await linkThroughAuthorize();
    expect(back.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_in_use");
  });

  it("cleanup: a row linked before Phase 1.2 that is no longer linkable is deleted on refresh and its project detached; classified rows are kept", async () => {
    const db = h.db as import("./helpers/fake-supabase").FakeDb;
    stubPersonalRepos();
    // Pre-Phase-1.2 row for another person's personal installation (unclassified, cleared by the migration).
    db.installations.push({
      id: "99999999-9999-4999-8999-999999999999",
      user_id: USER,
      installation_id: 66,
      account_login: "owner-person",
      created_at: "2026-11-10T00:00:00Z",
      github_user_id: 9001,
      github_user_login: "octocat",
      repos_synced_at: null,
      account_type: null,
      account_id: null,
    });
    db.projects.push({ id: "p-1", user_id: USER, installation_id: "99999999-9999-4999-8999-999999999999" });
    world.installations = [OTHER_PERSONAL, ORG_77];
    const response = await linkThroughAuthorize();
    expect(response.headers.get("location")).toBe("https://app.example.com/dashboard?connected=1");
    expect(db.installations.map((row) => row.installation_id)).toEqual([77]);
    expect(db.projects[0]?.installation_id).toBeNull();

    // The org is temporarily not listed: kept, cleared, needs a refresh.
    world.installations = [];
    const none = await linkThroughAuthorize();
    expect(none.headers.get("location")).toBe("https://app.example.com/dashboard?error=github_none");
    expect(db.installations.map((row) => [row.installation_id, row.repos_synced_at])).toEqual([[77, null]]);
    expect(db.repos).toEqual([]);
  });
});
