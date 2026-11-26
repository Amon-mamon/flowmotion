import type { Severity } from "@/features/analysis/schemas";

/**
 * Sample data for the decorative landing page previews (contract section 11,
 * Landing redesign F8). Repository `example/storefront` on `main`; nothing that
 * looks like a real company, person, or secret. Evidence is only ever the
 * masked form `sk…2a`.
 */

export const PREVIEW_REPO = "example/storefront";
export const PREVIEW_BRANCH = "main";

export type PreviewFileState = "read" | "blocked";

export type PreviewFile = {
  path: string;
  depth: number;
  kind: "dir" | "file";
  /** Scan result shown in step 02; directories have none. */
  state?: PreviewFileState;
};

export const PREVIEW_TREE: readonly PreviewFile[] = [
  { path: ".github/workflows", depth: 0, kind: "dir" },
  { path: "deploy.yml", depth: 1, kind: "file", state: "read" },
  { path: "src/app/api", depth: 0, kind: "dir" },
  { path: "orders/route.ts", depth: 1, kind: "file", state: "read" },
  { path: "webhooks/payments/route.ts", depth: 1, kind: "file", state: "read" },
  { path: "src/lib", depth: 0, kind: "dir" },
  { path: "mailer.ts", depth: 1, kind: "file", state: "read" },
  { path: "payments.ts", depth: 1, kind: "file", state: "read" },
  { path: ".env.local", depth: 0, kind: "file", state: "blocked" },
  { path: "certs/server.key", depth: 0, kind: "file", state: "blocked" },
  { path: "package.json", depth: 0, kind: "file", state: "read" },
];

export const PREVIEW_FILE_STATE_LABEL: Readonly<Record<PreviewFileState, string>> = {
  read: "Read",
  blocked: "Blocked for safety",
};

/** Files summary line in the hero analysis preview. */
export const PREVIEW_FILES_SUMMARY = {
  read: "42 files read",
  skipped: "6 blocked for safety",
} as const;

export const PREVIEW_FINDING = {
  severity: "high" satisfies Severity,
  category: "Hardcoded secret",
  location: "src/lib/payments.ts:14",
  maskedEvidence: "sk…2a",
  remediation: "Move this value to an environment variable and rotate the key.",
} as const;

export type PreviewRecommendation = {
  title: string;
  trigger: string;
  confidence: string;
  risk: Severity;
  credential: string;
  sourceFile: string;
};

export const PREVIEW_RECOMMENDATIONS: readonly PreviewRecommendation[] = [
  {
    title: "Alert the team when a payment fails",
    trigger: "Webhook",
    confidence: "92%",
    risk: "medium",
    credential: "Slack",
    sourceFile: "src/app/api/webhooks/payments/route.ts",
  },
  {
    title: "Send a daily order summary",
    trigger: "Schedule",
    confidence: "84%",
    risk: "low",
    credential: "Gmail",
    sourceFile: "src/app/api/orders/route.ts",
  },
  {
    title: "Post deploy results to chat",
    trigger: "Webhook",
    confidence: "71%",
    risk: "low",
    credential: "Slack",
    sourceFile: ".github/workflows/deploy.yml",
  },
];

export type PreviewNode = {
  key: string;
  label: string;
  nodeType: string;
  needsCredential: boolean;
  isTrigger: boolean;
};

export type PreviewEdge = { from: string; to: string; label?: string };

/**
 * One graph layout: coordinate space, node card size, edge direction, and
 * each node's top-left position. Landscape is used from 460 px of container
 * width, portrait below it so labels stay readable on phones.
 */
export type PreviewGraphLayout = {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  direction: "right" | "down";
  positions: Readonly<Record<string, { x: number; y: number }>>;
};

export const PREVIEW_NODES: readonly PreviewNode[] = [
  { key: "webhook", label: "New payment", nodeType: "n8n-nodes-base.webhook", needsCredential: false, isTrigger: true },
  { key: "if", label: "Did it fail?", nodeType: "n8n-nodes-base.if", needsCredential: false, isTrigger: false },
  { key: "slack", label: "Notify team", nodeType: "n8n-nodes-base.slack", needsCredential: true, isTrigger: false },
  {
    key: "respond",
    label: "Send reply",
    nodeType: "n8n-nodes-base.respondToWebhook",
    needsCredential: false,
    isTrigger: false,
  },
];

export const PREVIEW_LAYOUT_LANDSCAPE: PreviewGraphLayout = {
  width: 560,
  height: 300,
  nodeWidth: 168,
  nodeHeight: 60,
  direction: "right",
  positions: {
    webhook: { x: 0, y: 120 },
    if: { x: 196, y: 120 },
    slack: { x: 392, y: 30 },
    respond: { x: 392, y: 210 },
  },
};

export const PREVIEW_LAYOUT_PORTRAIT: PreviewGraphLayout = {
  width: 300,
  height: 400,
  nodeWidth: 140,
  nodeHeight: 56,
  direction: "down",
  positions: {
    webhook: { x: 80, y: 12 },
    if: { x: 80, y: 172 },
    slack: { x: 0, y: 340 },
    respond: { x: 160, y: 340 },
  },
};

export const PREVIEW_EDGES: readonly PreviewEdge[] = [
  { from: "webhook", to: "if" },
  { from: "if", to: "slack", label: "true" },
  { from: "if", to: "respond", label: "false" },
];

/** Short n8n JSON excerpt for the export card; placeholder, never a value. */
export const PREVIEW_JSON_LINES: readonly string[] = [
  "{",
  '  "name": "Alert the team when a payment fails",',
  '  "nodes": [',
  "    {",
  '      "type": "n8n-nodes-base.slack",',
  '      "parameters": {',
  '        "channel": "YOUR_SLACK_CHANNEL"',
  "      }",
  "    }",
  "  ],",
  '  "connections": { … }',
  "}",
];
