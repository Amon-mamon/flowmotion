import { collect, extension, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `db_write` signals: Supabase/Prisma/Drizzle writes, SQL INSERT/UPDATE,
 * Django `.objects.create`, ActiveRecord `.create`. Label = table or model
 * name when visible, else the call.
 */
export function extractDbWrites(file: ExtractorFile): Signal[] {
  const ext = extension(file.path);
  const { text } = file;
  const out: (Signal | null)[] = [];

  // Supabase: .from('orders').insert(...), across whitespace and newlines
  out.push(
    ...collect(/\.from\(\s*['"`]([\w.-]+)['"`]\s*\)\s*\.(insert|upsert|update)\(/g, text, (m) =>
      signal("db_write", file, m.index, m[1] ?? `supabase ${m[2] ?? ""}`),
    ),
  );
  // Prisma: prisma.order.create(...)
  out.push(
    ...collect(/\bprisma\.(\w+)\.(create|createMany|update|updateMany|upsert)\(/g, text, (m) =>
      signal("db_write", file, m.index, m[1] ?? "prisma"),
    ),
  );
  // Drizzle: db.insert(orders), db.update(orders)
  out.push(
    ...collect(/\bdb\.(insert|update)\(\s*(\w+)\s*\)/g, text, (m) =>
      signal("db_write", file, m.index, m[2] ?? `db.${m[1] ?? ""}`),
    ),
  );
  // SQL, raw or inside strings
  out.push(
    ...collect(/\bINSERT\s+INTO\s+["`]?([\w.]+)["`]?/gi, text, (m) =>
      signal("db_write", file, m.index, m[1] ?? "INSERT"),
    ),
  );
  out.push(
    ...collect(/\bUPDATE\s+["`]?([\w.]+)["`]?\s+SET\b/gi, text, (m) =>
      signal("db_write", file, m.index, m[1] ?? "UPDATE"),
    ),
  );
  if (ext === ".py") {
    out.push(
      ...collect(/\b([A-Z]\w*)\.objects\.create\(/g, text, (m) =>
        signal("db_write", file, m.index, m[1] ?? "objects.create"),
      ),
    );
  }
  if (ext === ".rb") {
    out.push(
      ...collect(/\b([A-Z]\w*)\.create!?\(/g, text, (m) => signal("db_write", file, m.index, m[1] ?? "create")),
    );
  }
  return out.filter(notNull);
}
