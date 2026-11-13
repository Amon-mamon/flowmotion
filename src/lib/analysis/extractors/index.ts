import { extractCiWorkflows } from "@/lib/analysis/extractors/ci-workflow";
import { extractDbWrites } from "@/lib/analysis/extractors/db-write";
import { extractEnvVars } from "@/lib/analysis/extractors/env-var";
import { extractMessaging } from "@/lib/analysis/extractors/messaging";
import { extractQueueConsumers } from "@/lib/analysis/extractors/queue-consumer";
import { extractRoutes } from "@/lib/analysis/extractors/route";
import { extractSchedules } from "@/lib/analysis/extractors/schedule";
import { MAX_MATCHES_PER_EXTRACTOR, type Extractor, type ExtractorFile } from "@/lib/analysis/extractors/util";
import { extractWebhooks } from "@/lib/analysis/extractors/webhook";
import { MAX_SIGNALS, type Signal } from "@/schemas/analysis";

/**
 * Static extractors (contract section 4 step 4, Phase 2 item 7). Pure,
 * regex based, run on REDACTED text only. Signals are derived data (paths,
 * names, cron expressions), never source text.
 */

export const EXTRACTORS: readonly Extractor[] = [
  extractRoutes,
  extractWebhooks,
  extractSchedules,
  extractQueueConsumers,
  extractMessaging,
  extractDbWrites,
  extractCiWorkflows,
  extractEnvVars,
];

export type { ExtractorFile } from "@/lib/analysis/extractors/util";

export function signalKey(signal: Signal): string {
  // env vars dedupe by name across the whole analysis.
  if (signal.kind === "env_var") return `env_var\u0000${signal.label}`;
  return `${signal.kind}\u0000${signal.filePath}\u0000${signal.label}`;
}

/** Dedupe on (kind, filePath, label), env vars by name; keep at most 500 in order. */
export function dedupeSignals(signals: readonly Signal[], max: number = MAX_SIGNALS): Signal[] {
  const seen = new Set<string>();
  const out: Signal[] = [];
  for (const signal of signals) {
    if (out.length >= max) break;
    const key = signalKey(signal);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }
  return out;
}

/** All signals of one file, deduped within the file. */
export function extractSignals(file: ExtractorFile): Signal[] {
  return dedupeSignals(EXTRACTORS.flatMap((extract) => extract(file).slice(0, MAX_MATCHES_PER_EXTRACTOR)));
}
