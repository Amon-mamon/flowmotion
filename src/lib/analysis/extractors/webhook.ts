import { extractRoutes } from "@/lib/analysis/extractors/route";
import { basename, collect, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `webhook` signals: routes whose path or file name contains "webhook", plus
 * Stripe `constructEvent`, GitHub `x-hub-signature`, and `svix`.
 */
export function extractWebhooks(file: ExtractorFile): Signal[] {
  const out: (Signal | null)[] = [];
  const fileIsWebhook = /webhook/i.test(file.path);
  const routes = extractRoutes(file);
  for (const route of routes) {
    if (fileIsWebhook || /webhook/i.test(route.label)) out.push({ ...route, kind: "webhook" });
  }
  if (routes.length === 0 && fileIsWebhook) out.push(signal("webhook", file, null, basename(file.path)));
  out.push(
    ...collect(/stripe\.webhooks\.constructEvent(?:Async)?\s*\(/g, file.text, (m) =>
      signal("webhook", file, m.index, "stripe"),
    ),
  );
  out.push(
    ...collect(/x-hub-signature(?:-256)?/gi, file.text, (m) => signal("webhook", file, m.index, "github")),
  );
  out.push(...collect(/\bsvix\b/gi, file.text, (m) => signal("webhook", file, m.index, "svix")));
  return out.filter(notNull);
}
