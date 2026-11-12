import type { Project, ProjectDetail } from "@/features/projects/schemas";

/** Sample DTOs (docs/contract.md section 6) for component tests only. */
export const pendingProject: Project = {
  id: "0b6a2c1e-1111-4a1a-9c1a-000000000001",
  repoFullName: "acme/storefront",
  defaultBranch: "main",
  status: "pending",
  invalidReason: null,
  detectedKind: null,
  lastCommitSha: null,
  stale: false,
  installationId: "7f2d9c4a-2222-4b2b-8d2b-000000000001",
  createdAt: "2026-11-09T10:15:00.000Z",
};

export const validProject: Project = {
  id: "0b6a2c1e-1111-4a1a-9c1a-000000000002",
  repoFullName: "acme/mobile-app",
  defaultBranch: "develop",
  status: "valid",
  invalidReason: null,
  detectedKind: "app",
  lastCommitSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  stale: true,
  installationId: "7f2d9c4a-2222-4b2b-8d2b-000000000001",
  createdAt: "2026-11-08T08:00:00.000Z",
};

export const invalidProject: Project = {
  id: "0b6a2c1e-1111-4a1a-9c1a-000000000003",
  repoFullName: "acme/notes",
  defaultBranch: "main",
  status: "invalid",
  invalidReason: "No source files found; the repository only contains documentation.",
  detectedKind: null,
  lastCommitSha: "ffffffffffffffffffffffffffffffffffffffff",
  stale: false,
  installationId: null,
  createdAt: "2026-11-07T18:30:00.000Z",
};

export const projects: Project[] = [pendingProject, validProject, invalidProject];

export const validProjectDetail: ProjectDetail = {
  ...validProject,
  analyses: [],
};
