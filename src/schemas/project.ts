import { z } from "zod";

import { analysisStatusSchema } from "@/schemas/analysis";
import { isoDateTimeSchema, jobErrorCodeSchema, uuidSchema } from "@/schemas/api";
import { branchNameSchema, repoFullNameSchema } from "@/schemas/github";

export { analysisStatusSchema, type AnalysisStatus } from "@/schemas/analysis";

export const projectStatusSchema = z.enum(["pending", "valid", "invalid"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const detectedKindSchema = z.enum(["website", "app"]);
export type DetectedKind = z.infer<typeof detectedKindSchema>;

/** Project DTO (docs/contract.md section 6). */
export const projectSchema = z.object({
  id: uuidSchema,
  repoFullName: repoFullNameSchema,
  /** Repository default branch at creation time (display only). */
  defaultBranch: z.string(),
  /** Branch chosen by the user (Phase 1.1); the only branch analyzed. */
  branch: z.string(),
  status: projectStatusSchema,
  invalidReason: z.string().nullable(),
  detectedKind: detectedKindSchema.nullable(),
  lastCommitSha: z.string().nullable(),
  stale: z.boolean(),
  /** github_installations.id, null once the installation is removed. */
  installationId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const projectAnalysisSummarySchema = z.object({
  id: uuidSchema,
  status: analysisStatusSchema,
  commitSha: z.string().nullable(),
  errorCode: jobErrorCodeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type ProjectAnalysisSummary = z.infer<typeof projectAnalysisSummarySchema>;

/** GET /api/projects/:id (analyses newest first, at most 20). */
export const projectDetailSchema = projectSchema.extend({
  analyses: z.array(projectAnalysisSummarySchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** GET /api/projects */
export const projectsResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;

/** Body of POST /api/projects. */
export const createProjectBodySchema = z.object({
  repoFullName: repoFullNameSchema,
  installationId: uuidSchema,
  branch: branchNameSchema,
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

/** Route param `:id` (uuid). */
export const idParamSchema = z.object({ id: uuidSchema });
