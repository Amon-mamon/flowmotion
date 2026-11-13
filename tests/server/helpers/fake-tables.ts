/**
 * Generic in-memory PostgREST-like reads for route tests: select / eq / in /
 * ilike / order / limit / maybeSingle / await. Rows are plain objects keyed
 * by table name. Tests only.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type Tables = Record<string, Row[]>;

class TableQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Filter[] = [];
  private readonly orders: { column: string; ascending: boolean }[] = [];
  private max = Infinity;
  selected: string | null = null;

  constructor(private readonly rows: () => Row[], private readonly onSelect?: (columns: string) => void) {}

  select(columns = "*"): this {
    this.selected = columns;
    this.onSelect?.(columns);
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  ilike(column: string, pattern: string): this {
    const wanted = pattern.replace(/\\(.)/g, "$1").toLowerCase();
    this.filters.push((row) => String(row[column]).toLowerCase() === wanted);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  private run(): Row[] {
    const out = this.rows().filter((row) => this.filters.every((filter) => filter(row)));
    out.sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const x = String(a[column] ?? "");
        const y = String(b[column] ?? "");
        if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    return out.slice(0, this.max).map((row) => ({ ...row }));
  }
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.run()[0] ?? null, error: null };
  }
  then<A = { data: Row[]; error: null }, B = never>(
    resolve?: ((value: { data: Row[]; error: null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve({ data: this.run(), error: null as null }).then(resolve, reject);
  }
}

export function tablesFrom(tables: Tables, onSelect?: (table: string, columns: string) => void) {
  return (table: string) => {
    const rows = tables[table];
    if (rows === undefined) throw new Error(`fake tables: unexpected table ${table}`);
    return new TableQuery(() => rows, (columns) => onSelect?.(table, columns));
  };
}
