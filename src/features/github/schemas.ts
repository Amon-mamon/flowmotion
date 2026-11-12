// Shared DTO schemas owned by backend (src/schemas, docs/contract.md section 6).
export {
  installationSchema,
  installationsResponseSchema as installationListSchema,
  repoSchema,
  reposResponseSchema as repoPageSchema,
} from "@/schemas/github";
export type { Installation, Repo, ReposResponse as RepoPage } from "@/schemas/github";
export { deletedSchema } from "@/schemas/api";
