// @vitest-environment node
/** linkGithubInstallations(): rpc arguments and error mapping (Phase 1.2, D-43, D-44). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import {
  GitHubAccountInUseError,
  GitHubAccountMismatchError,
  linkGithubInstallations,
} from "@/server/installations";

const input = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  githubUserId: 9001,
  githubUserLogin: "octocat",
  installations: [
    {
      installationId: 55,
      accountLogin: "octocat",
      accountType: "User" as const,
      accountId: 9001,
      repos: [{ id: 1, fullName: "octocat/a", private: true, defaultBranch: "main" }],
    },
    { installationId: 77, accountLogin: "acme", accountType: "Organization" as const, accountId: 7700, repos: [] },
  ],
};

beforeEach(() => {
  h.rpc.mockReset();
});

describe("linkGithubInstallations", () => {
  it("sends accountType and accountId per item and returns newly inserted ids", async () => {
    h.rpc.mockResolvedValue({
      data: [
        { installation_id: 55, inserted: true },
        { installation_id: 77, inserted: false },
      ],
      error: null,
    });
    expect(await linkGithubInstallations(input)).toEqual([55]);
    expect(h.rpc).toHaveBeenCalledWith("link_github_installations", {
      p_user_id: input.userId,
      p_github_user_id: 9001,
      p_github_user_login: "octocat",
      p_installations: [
        {
          installationId: 55,
          accountLogin: "octocat",
          accountType: "User",
          accountId: 9001,
          repos: [{ id: 1, fullName: "octocat/a", private: true, defaultBranch: "main" }],
        },
        { installationId: 77, accountLogin: "acme", accountType: "Organization", accountId: 7700, repos: [] },
      ],
    });
  });

  it("maps github_in_use to GitHubAccountInUseError", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "github_in_use" } });
    await expect(linkGithubInstallations(input)).rejects.toBeInstanceOf(GitHubAccountInUseError);
  });

  it("maps github_account_mismatch to GitHubAccountMismatchError", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "github_account_mismatch" } });
    await expect(linkGithubInstallations(input)).rejects.toBeInstanceOf(GitHubAccountMismatchError);
  });

  it("installation_not_allowed is a plain error carrying the code only", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "installation_not_allowed" } });
    const error = await linkGithubInstallations(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitHubAccountInUseError);
    expect(error).not.toBeInstanceOf(GitHubAccountMismatchError);
    expect((error as Error).message).toBe("link_github_installations failed: installation_not_allowed");
  });
});
