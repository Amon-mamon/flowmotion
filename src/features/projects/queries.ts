"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/features/api/client";
import {
  deletedSchema,
  projectDetailSchema,
  projectListSchema,
  projectSchema,
  type CreateProjectInput,
} from "@/features/projects/schemas";

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: string) => ["projects", projectId] as const,
};

/** `GET /api/projects` → newest first. */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: async ({ signal }) => {
      const data = await apiFetch("/api/projects", projectListSchema, { signal });
      return data.projects;
    },
  });
}

/** `GET /api/projects/:id`. */
export function useProject(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, projectDetailSchema, { signal }),
  });
}

/** `POST /api/projects`. */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiFetch("/api/projects", projectSchema, { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

/** `DELETE /api/projects/:id`. */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, deletedSchema, {
        method: "DELETE",
      }),
    onSuccess: (_data, projectId) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) });
      return queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
