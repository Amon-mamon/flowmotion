"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { ApiError, apiFetch } from "@/features/api/client";
import { signedOutSchema } from "@/schemas/api";

/**
 * `POST /api/auth/sign-out`, then navigate to `/login`.
 * A 401 means the session is already gone, so it is treated as signed out.
 * Any other failure stays on the page and is exposed as `error`.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();

  function leave() {
    queryClient.clear();
    router.push("/login");
    router.refresh();
  }

  return useMutation({
    mutationFn: async () => {
      try {
        return await apiFetch("/api/auth/sign-out", signedOutSchema, { method: "POST" });
      } catch (error) {
        if (error instanceof ApiError && error.code === "UNAUTHORIZED") {
          return { signedOut: true as const };
        }
        throw error;
      }
    },
    onSuccess: leave,
  });
}
