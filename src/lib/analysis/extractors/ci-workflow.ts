import { basename, isWorkflowFile, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/** `ci_workflow` signals: one per `.github/workflows/*` file. Label = `name:` or the file name. */
export function extractCiWorkflows(file: ExtractorFile): Signal[] {
  if (!isWorkflowFile(file.path)) return [];
  const match = /^name\s*:\s*(['"]?)(.+?)\1\s*$/m.exec(file.text);
  const label = match?.[2] ?? basename(file.path);
  const result = signal("ci_workflow", file, match === null ? null : match.index, label);
  return result === null ? [] : [result];
}
