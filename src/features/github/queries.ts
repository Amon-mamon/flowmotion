"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/features/api/client";
import {
  branchesResponseSchema,
  deletedSchema,
  installationListSchema,
  repoPageSchema,
} from "@/features/github/schemas";
import { projectKeys } from "@/features/projects/queries";

export const githubKeys = {
  installations: ["github", "installations"] as const,
  repos: (installationId: string) => ["github", "installations", installationId, "repos"] as const,
  branches: (installationId: string, repo: string) =>
    ["github", "installations", installationId, "branches", repo] as const,
};

/** `GET /api/github/installations`. */
export function useInstallations() {
  return useQuery({
    queryKey: githubKeys.installations,
    queryFn: async ({ signal }) => {
      const data = await apiFetch("/api/github/installations", installationListSchema, { signal });
      return data.installations;
    },
  });
}

/** `GET /api/github/installations/:id/repos?page=N`, paged on `hasMore`. */
export function useInstallationRepos(installationId: string | null) {
  return useInfiniteQuery({
    queryKey: githubKeys.repos(installationId ?? ""),
    enabled: installationId !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(
        `/api/github/installations/${encodeURIComponent(installationId ?? "")}/repos?page=${pageParam}`,
        repoPageSchema,
        { signal },
      ),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });
}

/** `GET /api/github/installations/:id/branches?repo=owner/name&page=N`, paged on `hasMore`. */
export function useRepoBranches(installationId: string | null, repo: string | null) {
  return useInfiniteQuery({
    queryKey: githubKeys.branches(installationId ?? "", repo ?? ""),
    enabled: installationId !== null && repo !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(
        `/api/github/installations/${encodeURIComponent(installationId ?? "")}/branches?repo=${encodeURIComponent(
          repo ?? "",
        )}&page=${pageParam}`,
        branchesResponseSchema,
        { signal },
      ),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });
}

/** `DELETE /api/github/installations/:id` (disconnect). */
export function useDisconnectInstallation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) =>
      apiFetch(`/api/github/installations/${encodeURIComponent(installationId)}`, deletedSchema, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: githubKeys.installations });
      // Projects lose their installationId after a disconnect.
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
