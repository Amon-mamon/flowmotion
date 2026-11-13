import type { BranchesResponse, Installation, Repo, RepoPage } from "@/features/github/schemas";

/** Sample DTOs (docs/contract.md section 6) for component tests only. */
export const acmeInstallation: Installation = {
  id: "7f2d9c4a-2222-4b2b-8d2b-000000000001",
  installationId: 12345678,
  accountLogin: "acme",
  createdAt: "2026-11-06T12:00:00.000Z",
  githubUserLogin: "jane-example",
  reposSyncedAt: "2026-11-13T08:00:00.000Z",
  needsRefresh: false,
};

export const personalInstallation: Installation = {
  id: "7f2d9c4a-2222-4b2b-8d2b-000000000002",
  installationId: 87654321,
  accountLogin: "jane-example",
  createdAt: "2026-11-05T09:30:00.000Z",
  // Linked before D-22: no GitHub user recorded and no access set yet.
  githubUserLogin: null,
  reposSyncedAt: null,
  needsRefresh: true,
};

export const installations: Installation[] = [acmeInstallation, personalInstallation];

export const reposPage1: Repo[] = [
  { fullName: "acme/storefront", defaultBranch: "main", private: false },
  { fullName: "acme/mobile-app", defaultBranch: "develop", private: true },
  { fullName: "acme/notes", defaultBranch: "main", private: true },
];

export const reposPage2: Repo[] = [
  { fullName: "acme/billing-service", defaultBranch: "main", private: true },
  { fullName: "acme/landing", defaultBranch: "main", private: false },
];

export const repoPage1: RepoPage = { repos: reposPage1, page: 1, hasMore: true };
export const repoPage2: RepoPage = { repos: reposPage2, page: 2, hasMore: false };

/** Branches of acme/storefront (default "main"). Page 1 omits the default and has a protected branch. */
export const branchesPage1: BranchesResponse = {
  branches: [
    { name: "develop", protected: true },
    { name: "feature/checkout", protected: false },
    { name: "release/2026-11", protected: false },
  ],
  defaultBranch: "main",
  page: 1,
  hasMore: true,
};

export const branchesPage2: BranchesResponse = {
  branches: [
    { name: "hotfix/cart", protected: false },
    { name: "main", protected: true },
  ],
  defaultBranch: "main",
  page: 2,
  hasMore: false,
};

/** API error body for GITHUB_REFRESH_REQUIRED (HTTP 403, D-22). */
export const refreshRequiredError = {
  code: "GITHUB_REFRESH_REQUIRED",
  message: "Refresh repository access to continue.",
  status: 403,
} as const;
