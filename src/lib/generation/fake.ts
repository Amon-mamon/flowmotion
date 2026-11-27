import { ANTHROPIC_TIMEOUT_MS } from "@/lib/analysis/model/anthropic";
import { estimateTokens } from "@/lib/analysis/prompt";
import type { AnalysisModel, AnalyzeInput, AnalyzeOutput } from "@/lib/analysis/model/types";

/**
 * Deterministic fake generation model used by tests (Phase 3b item 5). It
 * reads the trigger kind and source files out of the `<recommendation>`
 * block and returns a FlowSpecDraft that passes `checkFlowSpec`, compiles,
 * and passes the validator. Never selectable by env: only tests construct it.
 */

export interface FakeGenerationModelOptions {
  /**
   * Scripted responses consumed in order: a string is returned as the model
   * text, an Error is thrown. When exhausted, the derived draft is used.
   */
  script?: (string | Error)[];
  timeoutMs?: number;
}

export interface FakeGenerationModel extends AnalysisModel {
  readonly calls: AnalyzeInput[];
}

interface RecommendationFacts {
  trigger: "webhook" | "schedule" | "manual";
  sourceFiles: string[];
}

function readRecommendation(prompt: string): RecommendationFacts {
  const match = /<recommendation>\n([^\n]*)\n<\/recommendation>/.exec(prompt);
  const fallback: RecommendationFacts = { trigger: "manual", sourceFiles: [] };
  if (match?.[1] === undefined) return fallback;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const trigger = parsed.trigger_kind;
    const files = Array.isArray(parsed.source_files)
      ? parsed.source_files.filter((file): file is string => typeof file === "string")
      : [];
    return {
      trigger: trigger === "webhook" || trigger === "schedule" ? trigger : "manual",
      sourceFiles: files.slice(0, 3),
    };
  } catch {
    return fallback;
  }
}

/** A valid draft for the recommendation's trigger kind. */
export function deriveFlowSpecDraft(prompt: string): Record<string, unknown> {
  const facts = readRecommendation(prompt);
  const sourceFiles = facts.sourceFiles;
  const trigger =
    facts.trigger === "webhook"
      ? {
          key: "incoming",
          nodeType: "n8n-nodes-base.webhook",
          label: "Incoming Event",
          params: { path: "incoming-event", method: "POST", respond: "immediately" },
          ...(sourceFiles.length > 0 ? { sourceFiles } : {}),
        }
      : facts.trigger === "schedule"
        ? {
            key: "every_night",
            nodeType: "n8n-nodes-base.scheduleTrigger",
            label: "Every Night",
            params: { cron: "0 3 * * *" },
            ...(sourceFiles.length > 0 ? { sourceFiles } : {}),
          }
        : {
            key: "start",
            nodeType: "n8n-nodes-base.manualTrigger",
            label: "Start",
            params: {},
            ...(sourceFiles.length > 0 ? { sourceFiles } : {}),
          };
  const payload = facts.trigger === "webhook" ? { body: { id: "evt_1" } } : {};
  return {
    version: 1,
    name: "Team notification",
    description: "Builds a short summary and posts it to the team channel in Slack.",
    nodes: [
      trigger,
      {
        key: "summary",
        nodeType: "n8n-nodes-base.set",
        label: "Build Summary",
        params: { fields: [{ name: "source", value: "flowmotion" }], keepOtherFields: true },
      },
      {
        key: "notify",
        nodeType: "n8n-nodes-base.slack",
        label: "Notify Team",
        params: { channel: "YOUR_SLACK_CHANNEL", text: "New event from {{ $json.source }}" },
        notes: "Pick the Slack credential in n8n.",
      },
    ],
    edges: [
      { from: trigger.key, to: "summary" },
      { from: "summary", to: "notify" },
    ],
    tests: {
      cases: [
        {
          name: "Happy path",
          trigger: { kind: facts.trigger, payload },
          mocks: { notify: { ok: true } },
          expect: { reachedNodes: [trigger.key, "summary", "notify"] },
        },
      ],
    },
  };
}

export function createFakeGenerationModel(options: FakeGenerationModelOptions = {}): FakeGenerationModel {
  const script = [...(options.script ?? [])];
  const calls: AnalyzeInput[] = [];
  return {
    calls,
    timeoutMs: options.timeoutMs ?? ANTHROPIC_TIMEOUT_MS,
    async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
      calls.push(input);
      const next = script.shift();
      if (next instanceof Error) throw next;
      const text = next ?? JSON.stringify(deriveFlowSpecDraft(input.prompt));
      return {
        text,
        tokensIn: estimateTokens(input.system.length + input.prompt.length),
        tokensOut: estimateTokens(text.length),
      };
    },
  };
}
