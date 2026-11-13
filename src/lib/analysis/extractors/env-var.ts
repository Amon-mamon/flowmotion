import { basename, collect, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `env_var` signals: names only, never values. `process.env.X`,
 * `process.env["X"]`, `import.meta.env.X`, `os.environ[...]`,
 * `os.getenv(...)`, `ENV[...]`, `env('X')`, and the keys of `.env.example`.
 */
export const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

const PATTERNS: readonly RegExp[] = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bos\.environ(?:\.get\(\s*|\[\s*)['"]([^'"]+)['"]/g,
  /\bos\.getenv\(\s*['"]([^'"]+)['"]/g,
  /\bENV(?:\.fetch\(\s*|\[\s*)['"]([^'"]+)['"]/g,
  /\benv\(\s*['"]([^'"]+)['"]/g,
];

export function extractEnvVars(file: ExtractorFile): Signal[] {
  const out: (Signal | null)[] = [];
  const keep = (index: number, name: string | undefined): Signal | null =>
    name !== undefined && ENV_NAME.test(name) ? signal("env_var", file, index, name) : null;

  if (basename(file.path) === ".env.example") {
    out.push(
      ...collect(/^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm, file.text, (m) =>
        keep(m.index, m[1]),
      ),
    );
  }
  for (const pattern of PATTERNS) {
    out.push(...collect(pattern, file.text, (m) => keep(m.index, m[1])));
  }
  return out.filter(notNull);
}
