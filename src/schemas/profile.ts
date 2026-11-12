import { z } from "zod";

import { uuidSchema } from "@/schemas/api";

/** Profile DTO (docs/contract.md section 6). */
export const profileSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Body of PATCH /api/profile. Trimmed, 1..80 chars. */
export const updateProfileBodySchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name must be 1 to 80 characters")
    .max(80, "Display name must be 1 to 80 characters"),
});
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
