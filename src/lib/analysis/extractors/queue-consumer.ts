import { collect, extension, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `queue_consumer` signals: BullMQ workers, Nest `@Processor`, amqplib
 * `consume`, SQS `ReceiveMessage`, Celery tasks, Sidekiq, Laravel
 * `ShouldQueue`, Inngest and Trigger.dev functions. Label = the library.
 */
const PATTERNS: readonly { regexp: RegExp; label: string; ext?: readonly string[] }[] = [
  { regexp: /new\s+Worker\(\s*['"`]/g, label: "BullMQ Worker" },
  { regexp: /@Processor\(/g, label: "Nest Processor" },
  { regexp: /\.consume\(\s*['"`][\w.-]*['"`]\s*,/g, label: "amqplib consume" },
  { regexp: /\bReceiveMessage(?:Command)?\b|\.receiveMessage\(/g, label: "SQS ReceiveMessage" },
  { regexp: /@(?:shared_task|app\.task|celery\.task)\b/g, label: "Celery task", ext: [".py"] },
  { regexp: /\binclude\s+Sidekiq::(?:Worker|Job)\b/g, label: "Sidekiq", ext: [".rb"] },
  { regexp: /\bimplements\s+[\w\\, ]*ShouldQueue\b/g, label: "Laravel ShouldQueue", ext: [".php"] },
  { regexp: /\binngest\.createFunction\(/g, label: "Inngest function" },
  { regexp: /\b(?:client\.defineJob|task)\(\s*\{\s*id\s*:/g, label: "Trigger.dev task" },
];

export function extractQueueConsumers(file: ExtractorFile): Signal[] {
  const ext = extension(file.path);
  const out: (Signal | null)[] = [];
  for (const pattern of PATTERNS) {
    if (pattern.ext !== undefined && !pattern.ext.includes(ext)) continue;
    out.push(
      ...collect(pattern.regexp, file.text, (m) => signal("queue_consumer", file, m.index, pattern.label)),
    );
  }
  return out.filter(notNull);
}
