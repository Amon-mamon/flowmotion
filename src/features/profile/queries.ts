"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/features/api/client";
import { profileSchema } from "@/features/profile/schemas";

export const profileKeys = { me: ["profile"] as const };

/** `GET /api/profile`. */
export function useProfile() {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: ({ signal }) => apiFetch("/api/profile", profileSchema, { signal }),
  });
}

/** `PATCH /api/profile { displayName }`. */
export function useUpdateDisplayName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) =>
      apiFetch("/api/profile", profileSchema, { method: "PATCH", body: { displayName } }),
    onSuccess: (profile) => queryClient.setQueryData(profileKeys.me, profile),
  });
}
