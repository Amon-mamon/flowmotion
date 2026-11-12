// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getRepoInstallationId } from "@/lib/github/app-client";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";

let privateKeyPem = "";

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
}, 30_000);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getRepoInstallationId (R1-14)", () => {
  it("calls GET /repos/:owner/:repo/installation with the App JWT and returns the id", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json({ id: 4242, account: { login: "octo" }, app_id: 1 }));
    expect(await getRepoInstallationId({ appId: "1", privateKeyPem, fetch: fetchMock }, "octo/site")).toBe(4242);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/repos/octo/site/installation");
    const auth = (init?.headers as Record<string, string>).authorization ?? "";
    expect(auth).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(auth).not.toContain("ghs_");
  });

  it("returns null on 404 (App not installed on the repo, e.g. a public repo elsewhere)", async () => {
    const fetchMock: FetchLike = async () => json({ message: "Not Found" }, 404);
    expect(await getRepoInstallationId({ appId: "1", privateKeyPem, fetch: fetchMock }, "torvalds/linux")).toBeNull();
  });

  it("rejects bad payloads and other statuses", async () => {
    const bad: FetchLike = async () => json({ id: "4242" });
    await expect(getRepoInstallationId({ appId: "1", privateKeyPem, fetch: bad }, "octo/site")).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
    const err: FetchLike = async () => json({}, 500);
    await expect(getRepoInstallationId({ appId: "1", privateKeyPem, fetch: err }, "octo/site")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("refuses malformed names before any request", async () => {
    const fetchMock = vi.fn<FetchLike>();
    await expect(
      getRepoInstallationId({ appId: "1", privateKeyPem, fetch: fetchMock }, "a/b/c"),
    ).rejects.toBeInstanceOf(GitHubApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
