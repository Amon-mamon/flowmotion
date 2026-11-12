// Shared DTO schemas owned by backend (src/schemas, docs/contract.md section 6).
import { updateProfileBodySchema, type UpdateProfileBody } from "@/schemas/profile";

export { profileSchema } from "@/schemas/profile";
export type { Profile } from "@/schemas/profile";

/** `PATCH /api/profile` body: trimmed, 1..80 chars. */
export const displayNameFormSchema = updateProfileBodySchema;
export type DisplayNameFormValues = UpdateProfileBody;
