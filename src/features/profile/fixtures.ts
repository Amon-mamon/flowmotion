import type { Profile } from "@/features/profile/schemas";

/** Sample DTO (docs/contract.md section 6) for component tests only. */
export const profile: Profile = {
  id: "3c9e7d2b-3333-4c3c-9e3c-000000000001",
  email: "jane@example.com",
  displayName: "Jane Example",
};

export const profileWithoutName: Profile = {
  ...profile,
  displayName: null,
};
