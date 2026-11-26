/**
 * In-memory stand-in for the parts of Supabase the GitHub repo access code
 * touches (D-22): `github_installations` and `github_installation_repos`
 * reads through a tiny PostgREST-like builder, and an `rpc` that mirrors
 * `link_github_installations()` from
 * supabase/migrations/20261125120000_phase1_2_github_isolation.sql (account
 * mismatch, github_in_use, installation_not_allowed → nothing written;
 * upsert with account type/id, replace each set; unlisted rows: unclassified
 * ones deleted with projects detached, classified ones cleared).
 * Tests only; the SQL itself is exercised by the RLS suite on a real stack.
 */

export interface InstallationRecord {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string;
  created_at: string;
  github_user_id: number | null;
  github_user_login: string | null;
  repos_synced_at: string | null;
  account_type: "User" | "Organization" | null;
  account_id: number | null;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  installation_id: string | null;
}

export interface RepoRecord {
  user_id: string;
  installation_id: string;
  repo_id: number;
  repo_full_name: string;
  private: boolean;
  default_branch: string;
}

export interface FakeDb {
  installations: InstallationRecord[];
  repos: RepoRecord[];
  projects: ProjectRecord[];
  now: () => Date;
  nextId: () => string;
}

export function createFakeDb(now: () => Date = () => new Date()): FakeDb {
  let counter = 0;
  return {
    installations: [],
    repos: [],
    projects: [],
    now,
    nextId: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
  };
}

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function unescapeLike(pattern: string): string {
  return pattern.replace(/\\(.)/g, "$1");
}

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Filter[] = [];
  private max = Infinity;

  constructor(private readonly rows: () => Row[]) {}

  select(): this {
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
    const wanted = unescapeLike(pattern).toLowerCase();
    this.filters.push((row) => String(row[column]).toLowerCase() === wanted);
    return this;
  }
  order(): this {
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  private run(): Row[] {
    return this.rows()
      .filter((row) => this.filters.every((filter) => filter(row)))
      .slice(0, this.max)
      .map((row) => ({ ...row }));
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

/** `from()` for the session client (reads only). */
export function fakeFrom(db: FakeDb) {
  return (table: string) => {
    if (table === "github_installations") return new Query(() => db.installations as unknown as Row[]);
    if (table === "github_installation_repos") return new Query(() => db.repos as unknown as Row[]);
    throw new Error(`fake supabase: unexpected table ${table}`);
  };
}

interface LinkArgs {
  p_user_id: string;
  p_github_user_id: number;
  p_github_user_login: string;
  p_installations: {
    installationId: number;
    accountLogin: string;
    accountType: string;
    accountId: number;
    repos: { id: number; fullName: string; private: boolean; defaultBranch: string }[];
  }[];
}

/** Deletes rows like the FKs do: repo sets cascade, projects detach. */
export function deleteInstallationRows(db: FakeDb, predicate: (row: InstallationRecord) => boolean): void {
  const gone = new Set(db.installations.filter(predicate).map((row) => row.id));
  db.installations = db.installations.filter((row) => !gone.has(row.id));
  db.repos = db.repos.filter((repo) => !gone.has(repo.installation_id));
  for (const project of db.projects) {
    if (project.installation_id !== null && gone.has(project.installation_id)) project.installation_id = null;
  }
}

/** Mirrors link_github_installations() (contract section 5). */
export function fakeLink(db: FakeDb, args: LinkArgs) {
  const mine = db.installations.filter((row) => row.user_id === args.p_user_id);
  if (mine.some((row) => row.github_user_id !== null && row.github_user_id !== args.p_github_user_id)) {
    return { data: null, error: { code: "P0001", message: "github_account_mismatch" } };
  }
  if (db.installations.some((row) => row.user_id !== args.p_user_id && row.github_user_id === args.p_github_user_id)) {
    return { data: null, error: { code: "P0001", message: "github_in_use" } };
  }
  const linkable = (item: LinkArgs["p_installations"][number]) =>
    item.accountType === "Organization" || (item.accountType === "User" && item.accountId === args.p_github_user_id);
  if (!args.p_installations.every(linkable)) {
    return { data: null, error: { code: "P0001", message: "installation_not_allowed" } };
  }
  const nowIso = db.now().toISOString();
  const result: { installation_id: number; inserted: boolean }[] = [];
  const listed: number[] = [];
  for (const item of args.p_installations) {
    let row = mine.find((existing) => existing.installation_id === item.installationId);
    const inserted = row === undefined;
    if (row === undefined) {
      row = {
        id: db.nextId(),
        user_id: args.p_user_id,
        installation_id: item.installationId,
        account_login: item.accountLogin,
        created_at: nowIso,
        github_user_id: null,
        github_user_login: null,
        repos_synced_at: null,
        account_type: null,
        account_id: null,
      };
      db.installations.push(row);
    }
    row.account_login = item.accountLogin;
    row.github_user_id = args.p_github_user_id;
    row.github_user_login = args.p_github_user_login;
    row.repos_synced_at = nowIso;
    row.account_type = item.accountType === "Organization" ? "Organization" : "User";
    row.account_id = item.accountId;
    const rowId = row.id;
    db.repos = db.repos.filter((repo) => repo.installation_id !== rowId);
    for (const repo of item.repos) {
      if (db.repos.some((existing) => existing.installation_id === rowId && existing.repo_id === repo.id)) continue;
      db.repos.push({
        user_id: args.p_user_id,
        installation_id: rowId,
        repo_id: repo.id,
        repo_full_name: repo.fullName,
        private: repo.private,
        default_branch: repo.defaultBranch,
      });
    }
    listed.push(item.installationId);
    result.push({ installation_id: item.installationId, inserted });
  }
  deleteInstallationRows(
    db,
    (row) => row.user_id === args.p_user_id && row.account_type === null && !listed.includes(row.installation_id),
  );
  for (const row of db.installations) {
    if (row.user_id !== args.p_user_id || listed.includes(row.installation_id)) continue;
    db.repos = db.repos.filter((repo) => repo.installation_id !== row.id);
    row.repos_synced_at = null;
  }
  return { data: result, error: null };
}
