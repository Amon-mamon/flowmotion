import { estimateTokens } from "@/lib/analysis/prompt";
import type { AnalysisModel, AnalyzeInput, AnalyzeOutput } from "@/lib/analysis/model/types";

/**
 * Deterministic fake model used by every test (D-16). It reads the signals
 * and file paths out of the prompt and returns a fixed RecommendationDraft[]
 * derived from them. Never selectable by env: only tests construct it.
 */

interface FakeSignal {
  kind: string;
  file: string;
}

export interface FakeModelOptions {
  /**
   * Scripted responses consumed in order: a string is returned as the model
   * text, an Error is thrown. When exhausted, the derived drafts are used.
   */
  script?: (string | Error)[];
  /** Extra raw draft objects appended to the derived drafts (e.g. unknown node types). */
  extraDrafts?: unknown[];
}

export interface FakeModel extends AnalysisModel {
  readonly calls: AnalyzeInput[];
}

function readSignals(prompt: string): FakeSignal[] {
  const match = /<signals>\n([\s\S]*?)\n<\/signals>/.exec(prompt);
  if (match?.[1] === undefined) return [];
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FakeSignal =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).kind === "string" &&
        typeof (item as Record<string, unknown>).file === "string",
    );
  } catch {
    return [];
  }
}

function readSentPaths(prompt: string): string[] {
  const out: string[] = [];
  const re = /<repo_file path="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    if (match[1] !== undefined) out.push(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  }
  return out;
}

export function deriveDrafts(prompt: string): unknown[] {
  const signals = readSignals(prompt);
  const sent = new Set(readSentPaths(prompt));
  const filesFor = (kind: string) =>
    [...new Set(signals.filter((signal) => signal.kind === kind).map((signal) => signal.file))]
      .filter((file) => sent.has(file))
      .slice(0, 5);
  const has = (kind: string) => signals.some((signal) => signal.kind === kind);
  const drafts: unknown[] = [];

  if (has("webhook")) {
    drafts.push({
      title: "Alert Slack on incoming webhooks",
      description: "Receive the repository's webhook events in n8n and post a short summary to a Slack channel.",
      trigger_kind: "webhook",
      confidence: 0.82,
      source_files: filesFor("webhook"),
      required_credentials: ["Slack"],
      risk_level: "low",
      node_types: ["n8n-nodes-base.webhook", "n8n-nodes-base.respondToWebhook", "n8n-nodes-base.slack"],
      rationale: "The repository handles webhook requests, so mirroring them to Slack gives quick visibility.",
    });
  }
  if (has("schedule")) {
    drafts.push({
      title: "Daily scheduled health report",
      description: "Run on a schedule, call the app's own API, and email a short report of the results.",
      trigger_kind: "schedule",
      confidence: 0.7,
      source_files: filesFor("schedule"),
      required_credentials: ["SMTP"],
      risk_level: "low",
      node_types: ["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.httpRequest", "n8n-nodes-base.emailSend"],
      rationale: "Scheduled jobs exist in the repository, so a scheduled report fits the current setup.",
    });
  }
  if (has("db_write")) {
    drafts.push({
      title: "Copy new records to Google Sheets",
      description: "When the app writes new records, append them to a Google Sheet for reporting.",
      trigger_kind: "webhook",
      confidence: 0.6,
      source_files: filesFor("db_write"),
      required_credentials: ["Google"],
      risk_level: "medium",
      node_types: ["n8n-nodes-base.webhook", "n8n-nodes-base.set", "n8n-nodes-base.googleSheets"],
      rationale: "The code writes to the database, and a sheet export is a common reporting need.",
    });
  }
  drafts.push({
    title: "Manual API smoke test",
    description: "Start by hand, call the app's public URL, and branch on the response status.",
    trigger_kind: "manual",
    confidence: 0.4,
    source_files: [],
    required_credentials: [],
    risk_level: "low",
    node_types: ["n8n-nodes-base.manualTrigger", "n8n-nodes-base.httpRequest", "n8n-nodes-base.if"],
    rationale: "A manual check is useful for every web project and needs no credentials.",
  });
  return drafts;
}

export function createFakeModel(options: FakeModelOptions = {}): FakeModel {
  const script = [...(options.script ?? [])];
  const calls: AnalyzeInput[] = [];
  return {
    calls,
    async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
      calls.push(input);
      const next = script.shift();
      if (next instanceof Error) throw next;
      const text =
        next ?? JSON.stringify([...deriveDrafts(input.prompt), ...(options.extraDrafts ?? [])]);
      return {
        text,
        tokensIn: estimateTokens(input.system.length + input.prompt.length),
        tokensOut: estimateTokens(text.length),
      };
    },
  };
}
