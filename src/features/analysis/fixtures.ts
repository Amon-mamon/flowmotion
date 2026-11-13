import {
  analysisSchema,
  findingSchema,
  recommendationSchema,
  type Analysis,
  type AnalysisCounts,
  type AnalysisStatus,
  type Finding,
  type Recommendation,
  type Signal,
} from "@/features/analysis/schemas";
import { validProject } from "@/features/projects/fixtures";

/**
 * Sample Phase 2 DTOs (docs/contract.md section 6) for component tests only.
 * Every fixture is parsed with the DTO schema so a shape drift fails loudly.
 * All data is fake (example names, no real-looking secrets).
 */

export const fixtureProjectId = validProject.id;
const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const aid = (n: number) => `5c1d8e2f-3333-4c3c-8e3c-${String(n).padStart(12, "0")}`;
const fid = (n: number) => `9a4b6c7d-4444-4d4d-9f4d-${String(n).padStart(12, "0")}`;
const rid = (n: number) => `2e7f1a3b-5555-4e5e-af5e-${String(n).padStart(12, "0")}`;

export const zeroCounts: AnalysisCounts = {
  filesConsidered: 0,
  filesRead: 0,
  filesBlocked: 0,
  filesBlockedByReason: { denied: 0, extension: 0, size: 0, cap: 0 },
  filesSkippedBudget: 0,
};

/** 120 read; blocked 9 + 31 + 2 + 18 = 60; 7 skipped for budget. */
export const fullCounts: AnalysisCounts = {
  filesConsidered: 180,
  filesRead: 120,
  filesBlocked: 60,
  filesBlockedByReason: { denied: 9, extension: 31, size: 2, cap: 18 },
  filesSkippedBudget: 7,
};

export const signals: Signal[] = [
  { kind: "route", filePath: "src/app/api/orders/route.ts", line: 12, label: "POST /api/orders" },
  { kind: "route", filePath: "src/app/api/orders/route.ts", line: 30, label: "GET /api/orders" },
  { kind: "webhook", filePath: "src/app/api/stripe/webhook/route.ts", line: 8, label: "stripe.webhooks.constructEvent" },
  { kind: "schedule", filePath: "vercel.json", line: null, label: "0 3 * * *" },
  { kind: "messaging", filePath: "src/lib/mail.ts", line: 1, label: "nodemailer" },
  { kind: "db_write", filePath: "src/server/orders.ts", line: 44, label: "orders" },
  { kind: "ci_workflow", filePath: ".github/workflows/ci.yml", line: null, label: "CI" },
  { kind: "env_var", filePath: ".env.example", line: 3, label: "STRIPE_WEBHOOK_SECRET" },
];

function analysis(overrides: Partial<Analysis> & { status: AnalysisStatus; n: number }): Analysis {
  const { n, ...rest } = overrides;
  return analysisSchema.parse({
    id: aid(n),
    projectId: fixtureProjectId,
    progress: 0,
    commitSha: sha,
    branch: "release/2026-11",
    validation: null,
    counts: zeroCounts,
    signals: [],
    errorCode: null,
    startedAt: "2026-11-12T09:00:00.000Z",
    finishedAt: null,
    ...rest,
  });
}

export const queuedAnalysis = analysis({ n: 1, status: "queued", progress: 0, commitSha: null });
export const validatingAnalysis = analysis({ n: 2, status: "validating", progress: 5 });
export const scanningAnalysis = analysis({
  n: 3,
  status: "scanning",
  progress: 35,
  validation: { kind: "website", reason: null },
});
export const analyzingAnalysis = analysis({
  n: 4,
  status: "analyzing",
  progress: 75,
  validation: { kind: "website", reason: null },
  counts: fullCounts,
  signals,
});

/** `done` with recommendations (AI enabled). */
export const doneAnalysis = analysis({
  n: 5,
  status: "done",
  progress: 100,
  validation: { kind: "website", reason: null },
  counts: fullCounts,
  signals,
  finishedAt: "2026-11-12T09:02:00.000Z",
});

/** `done` with the AI kill switch on: findings and signals, no recommendations. */
export const aiDisabledAnalysis = analysis({
  n: 6,
  status: "done",
  progress: 100,
  validation: { kind: "app", reason: null },
  counts: { ...fullCounts, filesSkippedBudget: 0 },
  signals,
  errorCode: "AI_DISABLED",
  finishedAt: "2026-11-12T09:02:00.000Z",
});

/** `failed` because the model output could not be parsed; findings exist. */
export const modelInvalidAnalysis = analysis({
  n: 7,
  status: "failed",
  progress: 75,
  validation: { kind: "website", reason: null },
  counts: fullCounts,
  signals,
  errorCode: "MODEL_OUTPUT_INVALID",
  finishedAt: "2026-11-12T09:02:00.000Z",
});

export const accessLostAnalysis = analysis({
  n: 8,
  status: "failed",
  progress: 10,
  validation: { kind: "website", reason: null },
  errorCode: "GITHUB_ACCESS_LOST",
  finishedAt: "2026-11-12T09:01:00.000Z",
});

export const branchNotFoundAnalysis = analysis({
  n: 10,
  status: "failed",
  progress: 0,
  commitSha: null,
  errorCode: "BRANCH_NOT_FOUND",
  finishedAt: "2026-11-12T09:00:03.000Z",
});

export const internalFailedAnalysis = analysis({
  n: 9,
  status: "failed",
  progress: 65,
  validation: { kind: "website", reason: null },
  errorCode: "INTERNAL",
  finishedAt: "2026-11-12T09:01:00.000Z",
});

/** Exact invalid reasons from contract Phase 2 scope item 5. */
export const INVALID_REASONS = [
  "The repository is empty.",
  "The repository only contains documentation.",
  "No source code was found.",
  "No website or app framework was found. Flow Motion supports web and mobile app projects.",
] as const;

export const rejectedAnalyses: Analysis[] = INVALID_REASONS.map((reason, index) =>
  analysis({
    n: 20 + index,
    status: "rejected",
    progress: 5,
    validation: { kind: "invalid", reason },
    errorCode: "PROJECT_INVALID",
    finishedAt: "2026-11-12T09:00:05.000Z",
  }),
);

/** One fixture per status. */
export const analysesByStatus: Readonly<Record<AnalysisStatus, Analysis>> = {
  queued: queuedAnalysis,
  validating: validatingAnalysis,
  scanning: scanningAnalysis,
  analyzing: analyzingAnalysis,
  done: doneAnalysis,
  failed: modelInvalidAnalysis,
  rejected: rejectedAnalyses[0]!,
};

function finding(n: number, analysisId: string, rest: Omit<Finding, "id" | "analysisId">): Finding {
  return findingSchema.parse({ id: fid(n), analysisId, ...rest });
}

export function findingsFor(analysisId: string): Finding[] {
  return [
    finding(1, analysisId, {
      category: "committed_env_file",
      severity: "high",
      filePath: ".env.production",
      line: null,
      maskedEvidence: "file present (not opened)",
      remediation: "Remove the file from the repository, rotate every value in it, and add it to .gitignore.",
    }),
    finding(2, analysisId, {
      category: "hardcoded_secret",
      severity: "high",
      filePath: "src/lib/payments.ts",
      line: 7,
      maskedEvidence: "Stripe secret key: sk…9Q",
      remediation: "Move the key to an environment variable and rotate it.",
    }),
    finding(3, analysisId, {
      category: "client_exposed_secret",
      severity: "medium",
      filePath: "src/lib/supabase.ts",
      line: 4,
      maskedEvidence: "NEXT_PUBLIC_SERVICE_ROLE_KEY",
      remediation: "Never expose a secret through a public client variable; read it on the server only.",
    }),
    finding(4, analysisId, {
      category: "debug_config",
      severity: "low",
      filePath: "backend/settings.py",
      line: 22,
      maskedEvidence: "debug flag",
      remediation: "Turn debug mode off in production settings.",
    }),
  ];
}

function recommendation(
  n: number,
  analysisId: string,
  rest: Partial<Omit<Recommendation, "id" | "analysisId">> & Pick<Recommendation, "title">,
): Recommendation {
  return recommendationSchema.parse({
    id: rid(n),
    analysisId,
    description: "Sends a message to the team when something happens in the app.",
    triggerKind: "webhook",
    confidence: 0.8,
    sourceFiles: ["src/app/api/orders/route.ts"],
    requiredCredentials: ["Slack"],
    riskLevel: "low",
    nodeTypes: ["n8n-nodes-base.webhook", "n8n-nodes-base.slack"],
    rationale: "The orders route creates rows that the team wants to hear about.",
    estimatedTokens: 6000,
    status: "new",
    flowId: null,
    ...rest,
  });
}

export function recommendationsFor(analysisId: string): Recommendation[] {
  return [
    recommendation(1, analysisId, { title: "Notify Slack on new orders", confidence: 0.92 }),
    recommendation(2, analysisId, {
      title: "Nightly order summary email",
      triggerKind: "schedule",
      confidence: 0.74,
      requiredCredentials: ["SMTP", "Postgres"],
      riskLevel: "medium",
      sourceFiles: ["vercel.json", "src/server/orders.ts"],
      nodeTypes: ["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.postgres", "n8n-nodes-base.emailSend"],
      rationale: "A cron entry in vercel.json already runs nightly; the summary can move to n8n.",
    }),
    recommendation(3, analysisId, {
      title: "Manual customer export",
      triggerKind: "manual",
      confidence: 0.41,
      requiredCredentials: [],
      riskLevel: "high",
      rationale: "Exports touch customer data, so this one is marked high risk.",
    }),
  ];
}

export const doneFindings = findingsFor(doneAnalysis.id);
export const doneRecommendations = recommendationsFor(doneAnalysis.id);
export const emptyFindings: Finding[] = [];
export const emptyRecommendations: Recommendation[] = [];
