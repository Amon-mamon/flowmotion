// Shared Phase 3 flow DTO schemas owned by backend (src/schemas/flow.ts,
// docs/contract.md section 6). The frontend imports them through this file so
// components keep stable names.
export {
  FLOW_STATUSES,
  flowStatusSchema,
  jsonValueSchema,
  setupChecklistSchema,
  flowNodeViewSchema,
  flowEdgeViewSchema,
  testRunSummarySchema,
  flowDetailSchema,
  flowSummarySchema,
  flowsResponseSchema,
  generateBodySchema,
  generateResponseSchema,
} from "@/schemas/flow";
export type {
  FlowStatus,
  JsonValue,
  SetupChecklist,
  FlowNodeView,
  FlowEdgeView,
  TestRunSummary,
  FlowDetail,
  FlowSummary,
  FlowsResponse,
  GenerateBody,
  GenerateResponse,
} from "@/schemas/flow";
export { JOB_ERROR_CODES, jobErrorCodeSchema, type JobErrorCode } from "@/schemas/api";
