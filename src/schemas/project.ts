import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "@/schemas/api";
import { repoFullNameSchema } from "@/schemas/github";

export const projectStatusSchema = z.enum(["pending", "valid", "invalid"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const detectedKindSchema = z.enum(["website", "app"]);
export type DetectedKind = z.infer<typeof detectedKindSchema>;

export const analysisStatusSchema = z.enum([
  "queued",
  "validating",
  "scanning",
  "analyzing",
  "done",
  "failed",
  "rejected",
]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/** Project DTO (docs/contract.md section 6). */
export const projectSchema = z.object({
  id: uuidSchema,
  repoFullName: repoFullNameSchema,
  defaultBranch: z.string(),
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
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type ProjectAnalysisSummary = z.infer<typeof projectAnalysisSummarySchema>;

/** GET /api/projects/:id */
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
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

/** Route param `:id` (uuid). */
export const idParamSchema = z.object({ id: uuidSchema });
