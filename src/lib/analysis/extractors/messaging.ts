import { collect, extension, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/** `messaging` signals: email/chat/SMS SDK imports. Label = the library. */
export const MESSAGING_LIBRARIES = [
  "nodemailer",
  "resend",
  "@sendgrid/mail",
  "postmark",
  "@slack/web-api",
  "@slack/bolt",
  "discord.js",
  "telegraf",
  "node-telegram-bot-api",
  "twilio",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const JS_IMPORT = new RegExp(
  `(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)(['"])(${MESSAGING_LIBRARIES.map(escapeRegExp).join("|")})\\1`,
  "g",
);

export function extractMessaging(file: ExtractorFile): Signal[] {
  const ext = extension(file.path);
  const out: (Signal | null)[] = [];
  if (ext === ".py") {
    out.push(
      ...collect(/^\s*(?:import\s+smtplib|from\s+smtplib\s+import)\b/gm, file.text, (m) =>
        signal("messaging", file, m.index, "smtplib"),
      ),
    );
    out.push(
      ...collect(/^\s*(?:import\s+slack_sdk|from\s+slack_sdk(?:\.\w+)*\s+import)\b/gm, file.text, (m) =>
        signal("messaging", file, m.index, "slack_sdk"),
      ),
    );
  } else {
    out.push(...collect(JS_IMPORT, file.text, (m) => signal("messaging", file, m.index, m[2] ?? "")));
  }
  return out.filter(notNull);
}
