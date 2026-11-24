import { doneAnalysis, doneRecommendations, fixtureProjectId } from "@/features/analysis/fixtures";
import {
  JOB_ERROR_CODES,
  flowDetailSchema,
  flowSummarySchema,
  type FlowDetail,
  type FlowEdgeView,
  type FlowNodeView,
  type FlowSummary,
  type JobErrorCode,
  type SetupChecklist,
} from "@/features/flows/schemas";
import { validProject } from "@/features/projects/fixtures";

/**
 * Sample Phase 3 DTOs (docs/contract.md section 6) for component tests only.
 * Every fixture is parsed with the DTO schema so a shape drift fails loudly.
 * All data is fake (example names, `YOUR_…` placeholders, no real destinations).
 * Phase 3b only swaps the data source: pages already call the real endpoints.
 */

export const flowId = (n: number) => `7d1e2f3a-6666-4f6f-8a6f-${String(n).padStart(12, "0")}`;

/** Compiler layout (contract section 8): x = 250 + 220 × column, y = 300 + 160 × row. */
const at = (column: number, row: number) => ({ x: 250 + 220 * column, y: 300 + 160 * row });

const base = "n8n-nodes-base.";

/** webhook → if → (true) slack / (false) httpRequest → merge → postgres → respondToWebhook */
export const readyNodes: FlowNodeView[] = [
  {
    key: "order_webhook",
    label: "Order webhook",
    nodeType: `${base}webhook`,
    tier: 1,
    isTrigger: true,
    params: { path: "orders", method: "POST", respond: "respondNode" },
    credential: null,
    sourceFiles: ["src/app/api/orders/route.ts"],
    notes: "Receives the same payload the app posts to /api/orders.",
    position: at(0, 0),
    inputs: 0,
    outputs: 1,
    outputLabels: [""],
  },
  {
    key: "is_paid",
    label: "Is paid order",
    nodeType: `${base}if`,
    tier: 1,
    isTrigger: false,
    params: {
      conditions: [{ left: "{{ $json.status }}", op: "equals", right: "paid" }],
      combine: "and",
    },
    credential: null,
    sourceFiles: [],
    notes: null,
    position: at(1, 0),
    inputs: 1,
    outputs: 2,
    outputLabels: ["true", "false"],
  },
  {
    key: "notify_team",
    label: "Notify team",
    nodeType: `${base}slack`,
    tier: 2,
    isTrigger: false,
    params: { channel: "YOUR_SLACK_CHANNEL", text: "New paid order {{ $json.id }}" },
    credential: "Slack",
    sourceFiles: ["src/app/api/orders/route.ts"],
    notes: null,
    position: at(2, 0),
    inputs: 1,
    outputs: 1,
    outputLabels: [""],
  },
  {
    key: "fetch_order",
    label: "Fetch order details",
    nodeType: `${base}httpRequest`,
    tier: 2,
    isTrigger: false,
    params: { method: "GET", baseUrl: "YOUR_API_URL", path: "/orders/{{ $json.id }}", query: [] },
    credential: null,
    sourceFiles: [],
    notes: null,
    position: at(2, 1),
    inputs: 1,
    outputs: 1,
    outputLabels: [""],
  },
  {
    key: "join",
    label: "Join branches",
    nodeType: `${base}merge`,
    tier: 1,
    isTrigger: false,
    params: { mode: "append" },
    credential: null,
    sourceFiles: [],
    notes: null,
    position: at(3, 0),
    inputs: 2,
    outputs: 1,
    outputLabels: [""],
  },
  {
    key: "log_order",
    label: "Log order",
    nodeType: `${base}postgres`,
    tier: 2,
    isTrigger: false,
    params: {
      operation: "insert",
      table: "order_events",
      columns: [
        { name: "order_id", value: "{{ $json.id }}" },
        { name: "paid", value: true },
        { name: "attempt", value: 1 },
      ],
    },
    credential: "Postgres",
    sourceFiles: ["src/server/orders.ts"],
    notes: null,
    position: at(4, 0),
    inputs: 1,
    outputs: 1,
    outputLabels: [""],
  },
  {
    key: "reply",
    label: "Reply to caller",
    nodeType: `${base}respondToWebhook`,
    tier: 1,
    isTrigger: false,
    params: { statusCode: 200, body: [{ name: "ok", value: true }] },
    credential: null,
    sourceFiles: [],
    notes: null,
    position: at(5, 0),
    inputs: 1,
    outputs: 1,
    outputLabels: [""],
  },
];

const edge = (from: string, output: number, to: string, input: number): FlowEdgeView => ({
  id: `${from}:${output}->${to}:${input}`,
  from,
  to,
  output,
  input,
});

export const readyEdges: FlowEdgeView[] = [
  edge("order_webhook", 0, "is_paid", 0),
  edge("is_paid", 0, "notify_team", 0),
  edge("is_paid", 1, "fetch_order", 0),
  edge("notify_team", 0, "join", 0),
  edge("fetch_order", 0, "join", 1),
  edge("join", 0, "log_order", 0),
  edge("log_order", 0, "reply", 0),
];

/** exact (contract section 8): the five fixed warning sentences, in order. */
export const ALL_WARNINGS = [
  "Review every node before you activate the workflow in n8n.",
  "n8n creates a new webhook URL on import. Copy it from the Webhook node into the service that calls it.",
  "Add authentication to each HTTP Request node in n8n if your API needs it.",
  "This flow writes data. Try it with test data before using production.",
  "This flow sends messages. Point it at a test channel or address first.",
] as const;

export const readyChecklist: SetupChecklist = {
  credentials: [
    { name: "Postgres", usedBy: ["Log order"] },
    { name: "Slack", usedBy: ["Notify team"] },
  ],
  placeholders: [
    { name: "YOUR_API_URL", usedBy: ["Fetch order details"] },
    { name: "YOUR_SLACK_CHANNEL", usedBy: ["Notify team"] },
  ],
  warnings: [...ALL_WARNINGS],
};

/** A flow that needs nothing from the user: only the always-on warning. */
export const emptyChecklist: SetupChecklist = {
  credentials: [],
  placeholders: [],
  warnings: [ALL_WARNINGS[0]],
};

function flow(n: number, overrides: Partial<FlowDetail> & Pick<FlowDetail, "status">): FlowDetail {
  return flowDetailSchema.parse({
    id: flowId(n),
    recommendationId: doneRecommendations[0]!.id,
    analysisId: doneAnalysis.id,
    projectId: fixtureProjectId,
    repoFullName: validProject.repoFullName,
    name: "Notify Slack on new orders",
    description: "Posts a message to the team channel when a paid order arrives, then logs it.",
    errorCode: null,
    n8nVersion: null,
    catalogVersion: null,
    importVerified: false,
    nodes: [],
    edges: [],
    checklist: null,
    latestTestRun: null,
    createdAt: "2026-11-25T09:30:00.000Z",
    ...overrides,
  });
}

export const generatingFlow = flow(1, { status: "generating", description: null });

const ready = {
  status: "ready",
  n8nVersion: "1.74.3",
  catalogVersion: "1.74.3",
  nodes: readyNodes,
  edges: readyEdges,
  checklist: readyChecklist,
} as const satisfies Partial<FlowDetail>;

/** `importVerified` false: the export panel shows the "not yet verified" notice. */
export const readyFlow = flow(2, { ...ready, importVerified: false });
/** `importVerified` true: no notice. */
export const verifiedFlow = flow(3, { ...ready, importVerified: true });

/** A single manual trigger: no credentials, no placeholders, no parameters. */
export const minimalFlow = flow(4, {
  ...ready,
  importVerified: true,
  name: "Manual customer export",
  description: null,
  nodes: [
    {
      key: "start",
      label: "Start",
      nodeType: `${base}manualTrigger`,
      tier: 1,
      isTrigger: true,
      params: {},
      credential: null,
      sourceFiles: [],
      notes: null,
      position: at(0, 0),
      inputs: 0,
      outputs: 1,
      outputLabels: [""],
    },
  ],
  edges: [],
  checklist: emptyChecklist,
});

/** One `failed` flow per job error code. */
export const failedFlows = Object.fromEntries(
  JOB_ERROR_CODES.map((code, index) => [code, flow(10 + index, { status: "failed", errorCode: code })]),
) as Readonly<Record<JobErrorCode, FlowDetail>>;

function summary(detail: FlowDetail): FlowSummary {
  return flowSummarySchema.parse({
    id: detail.id,
    recommendationId: detail.recommendationId,
    analysisId: detail.analysisId,
    projectId: detail.projectId,
    repoFullName: detail.repoFullName,
    name: detail.name,
    status: detail.status,
    errorCode: detail.errorCode,
    createdAt: detail.createdAt,
  });
}

/** `GET /api/flows` rows (newest first in the API; order here is illustrative). */
export const flowSummaries: FlowSummary[] = [
  summary(generatingFlow),
  summary(readyFlow),
  summary(failedFlows.GENERATION_EXHAUSTED),
];
