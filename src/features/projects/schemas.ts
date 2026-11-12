// Shared DTO schemas owned by backend (src/schemas, docs/contract.md section 6).
export {
  projectStatusSchema,
  detectedKindSchema,
  analysisStatusSchema,
  projectSchema,
  projectAnalysisSummarySchema,
  projectDetailSchema,
  projectsResponseSchema as projectListSchema,
  createProjectBodySchema as createProjectInputSchema,
} from "@/schemas/project";
export type {
  ProjectStatus,
  DetectedKind,
  Project,
  ProjectAnalysisSummary,
  ProjectDetail,
  CreateProjectBody as CreateProjectInput,
} from "@/schemas/project";
export { deletedSchema } from "@/schemas/api";
