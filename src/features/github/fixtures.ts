import type { Installation, Repo, RepoPage } from "@/features/github/schemas";

/** Sample DTOs (docs/contract.md section 6) for component tests only. */
export const acmeInstallation: Installation = {
  id: "7f2d9c4a-2222-4b2b-8d2b-000000000001",
  installationId: 12345678,
  accountLogin: "acme",
  createdAt: "2026-11-06T12:00:00.000Z",
};

export const personalInstallation: Installation = {
  id: "7f2d9c4a-2222-4b2b-8d2b-000000000002",
  installationId: 87654321,
  accountLogin: "jane-example",
  createdAt: "2026-11-05T09:30:00.000Z",
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
