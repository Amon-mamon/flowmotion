import {
  basename,
  collect,
  extension,
  isWorkflowFile,
  notNull,
  signal,
  type ExtractorFile,
} from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `schedule` signals: vercel.json crons, GitHub Actions `on.schedule.cron`,
 * node-cron `cron.schedule(`, Nest `@Cron(`, Celery beat, SQL `cron.schedule`.
 * Label = the cron expression, or "schedule" when none is visible.
 */

const CRON_EXPRESSION = /^[0-9*/,\-? A-Za-z#@]{1,100}$/;

export function cronLabel(expression: string | undefined): string {
  const trimmed = (expression ?? "").trim();
  return trimmed !== "" && CRON_EXPRESSION.test(trimmed) ? trimmed : "schedule";
}

function vercelCrons(file: ExtractorFile): (Signal | null)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const crons = (parsed as Record<string, unknown>).crons;
  if (!Array.isArray(crons)) return [];
  return crons.map((entry: unknown) => {
    const schedule =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>).schedule
        : undefined;
    const text = typeof schedule === "string" ? schedule : undefined;
    const index = text === undefined ? -1 : file.text.indexOf(text);
    return signal("schedule", file, index >= 0 ? index : null, cronLabel(text));
  });
}

export function extractSchedules(file: ExtractorFile): Signal[] {
  const out: (Signal | null)[] = [];
  const { path, text } = file;
  const ext = extension(path);

  if (basename(path) === "vercel.json") out.push(...vercelCrons(file));

  if (isWorkflowFile(path)) {
    out.push(
      ...collect(/^\s*-?\s*cron\s*:\s*(['"])([^'"]+)\1/gm, text, (m) =>
        signal("schedule", file, m.index, cronLabel(m[2])),
      ),
    );
  }

  if (ext === ".sql") {
    // pg_cron: cron.schedule('job-name', '0 3 * * *', ...) or cron.schedule('0 3 * * *', ...)
    out.push(
      ...collect(/cron\.schedule\(\s*'([^']*)'\s*(?:,\s*'([^']*)')?/gi, text, (m) => {
        const second = m[2];
        const expression = second !== undefined && CRON_EXPRESSION.test(second) ? second : m[1];
        return signal("schedule", file, m.index, cronLabel(expression));
      }),
    );
  } else {
    // node-cron / cron packages
    out.push(
      ...collect(/\bcron\.schedule\(\s*(['"`])([^'"`]+)\1/g, text, (m) =>
        signal("schedule", file, m.index, cronLabel(m[2])),
      ),
    );
    out.push(
      ...collect(/new\s+CronJob\(\s*(['"`])([^'"`]+)\1/g, text, (m) =>
        signal("schedule", file, m.index, cronLabel(m[2])),
      ),
    );
    // NestJS: @Cron('0 * * * *') or @Cron(CronExpression.EVERY_HOUR)
    out.push(
      ...collect(/@Cron\(\s*(?:(['"`])([^'"`]+)\1|([A-Za-z_.]+))/g, text, (m) =>
        signal("schedule", file, m.index, m[2] !== undefined ? cronLabel(m[2]) : (m[3] ?? "schedule")),
      ),
    );
  }

  if (ext === ".py") {
    out.push(...collect(/\bbeat_schedule\b/g, text, (m) => signal("schedule", file, m.index, "schedule")));
    out.push(...collect(/\bcrontab\(/g, text, (m) => signal("schedule", file, m.index, "schedule")));
  }

  return out.filter(notNull);
}
