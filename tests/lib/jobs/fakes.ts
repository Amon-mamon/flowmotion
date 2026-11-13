/**
 * In-memory fakes for the worker (WorkerDb, WorkerGitHub). They mirror
 * claim_job() (stale-lock re-queue, oldest due job, attempts + 1) and the
 * lock-guarded job update. Tests only; the SQL is exercised by the RLS suite.
 */
import { GitHubApiError } from "@/lib/github/errors";
import type {
  AnalysisPatch,
  AnalysisRef,
  JobPatch,
  JobRow,
  ProjectPatch,
  ProjectRef,
  RecommendationInsert,
  TreeBlobEntry,
  UsageEventInsert,
  WorkerDb,
  WorkerGitHub,
} from "@/lib/jobs/types";
import type { MaskedFinding } from "@/lib/security/secret-scanner";

export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PROJECT = "33333333-3333-4333-8333-333333333333";
export const ANALYSIS = "44444444-4444-4444-8444-444444444444";
export const JOB = "55555555-5555-4555-8555-555555555555";
export const INSTALL_ROW = "11111111-1111-4111-8111-111111111111";
export const GITHUB_INSTALLATION_ID = 777;
export const HEAD = "c".repeat(40);
export const REPO_ID = 4242;

export type AnalysisRecord = AnalysisRef & Record<string, unknown>;

export class FakeClock {
  constructor(public ms = Date.parse("2026-11-13T10:00:00Z")) {}
  now = () => new Date(this.ms);
  advance(ms: number) {
    this.ms += ms;
  }
}

export class FakeWorkerDb implements WorkerDb {
  jobs: JobRow[] = [];
  analyses = new Map<string, AnalysisRecord>();
  projects = new Map<string, ProjectRef & Record<string, unknown>>();
  installations = new Map<string, { user_id: string; installation_id: number }>();
  findings: (MaskedFinding & { analysis_id: string; user_id: string })[] = [];
  recommendations: (RecommendationInsert & { analysis_id: string; user_id: string })[] = [];
  usage: UsageEventInsert[] = [];
  /** Every state written to a job, serialised (to prove no raw text reaches it). */
  stateWrites: string[] = [];
  progressHistory: number[] = [];

  constructor(private readonly clock: FakeClock) {}

  /** Every claim_job call: [workerId, userId]. */
  claimCalls: [string, string | undefined][] = [];

  seed(
    options: {
      branch?: string;
      installationRowId?: string | null;
      aiState?: Record<string, unknown>;
      repoId?: number | null;
    } = {},
  ) {
    this.installations.set(INSTALL_ROW, { user_id: USER, installation_id: GITHUB_INSTALLATION_ID });
    this.projects.set(PROJECT, {
      id: PROJECT,
      user_id: USER,
      repo_full_name: "acme/shop",
      repo_id: options.repoId === undefined ? REPO_ID : options.repoId,
      installation_id: options.installationRowId === undefined ? INSTALL_ROW : options.installationRowId,
      status: "pending",
      default_branch: "main",
    });
    this.analyses.set(ANALYSIS, {
      id: ANALYSIS,
      project_id: PROJECT,
      user_id: USER,
      status: "queued",
      progress: 0,
      branch: options.branch ?? "release/v2",
    });
    const iso = this.clock.now().toISOString();
    this.jobs.push({
      id: JOB,
      user_id: USER,
      kind: "analyze",
      ref_id: ANALYSIS,
      status: "queued",
      step: "validate",
      state: options.aiState ?? {},
      attempts: 0,
      max_attempts: 5,
      run_after: iso,
      locked_at: null,
      locked_by: null,
      last_error_code: null,
      created_at: iso,
      updated_at: iso,
    });
  }

  get job(): JobRow {
    const job = this.jobs[0];
    if (job === undefined) throw new Error("no job");
    return job;
  }

  get analysis(): AnalysisRecord {
    const row = this.analyses.get(ANALYSIS);
    if (row === undefined) throw new Error("no analysis");
    return row;
  }

  async claimJob(workerId: string, userId?: string): Promise<JobRow | null> {
    this.claimCalls.push([workerId, userId]);
    const now = this.clock.ms;
    for (const job of this.jobs) {
      if (userId !== undefined && job.user_id !== userId) continue;
      if (job.status === "running" && job.locked_at !== null && Date.parse(job.locked_at) < now - 120_000) {
        job.status = "queued";
        job.locked_at = null;
        job.locked_by = null;
      }
    }
    const due = this.jobs
      .filter((job) => job.status === "queued" && Date.parse(job.run_after) <= now)
      .filter((job) => userId === undefined || job.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (due === undefined) return null;
    due.status = "running";
    due.locked_at = new Date(now).toISOString();
    due.locked_by = workerId;
    due.attempts += 1;
    return structuredClone(due);
  }

  async updateJob(jobId: string, workerId: string, patch: JobPatch): Promise<boolean> {
    const job = this.jobs.find((row) => row.id === jobId);
    if (job === undefined || job.locked_by !== workerId || job.status !== "running") return false;
    if (patch.state !== undefined) this.stateWrites.push(JSON.stringify(patch.state));
    Object.assign(job, patch, { updated_at: this.clock.now().toISOString() });
    return true;
  }

  async getAnalysis(id: string): Promise<AnalysisRef | null> {
    const row = this.analyses.get(id);
    return row === undefined ? null : { ...row };
  }

  async updateAnalysis(id: string, patch: AnalysisPatch): Promise<void> {
    const row = this.analyses.get(id);
    if (row === undefined) throw new Error("analysis missing");
    if (patch.progress !== undefined) this.progressHistory.push(patch.progress);
    Object.assign(row, patch);
  }

  async getProject(id: string): Promise<ProjectRef | null> {
    const row = this.projects.get(id);
    return row === undefined ? null : { ...row };
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<void> {
    const row = this.projects.get(id);
    if (row === undefined) throw new Error("project missing");
    Object.assign(row, patch);
  }

  async getInstallationGithubId(rowId: string, userId: string): Promise<number | null> {
    const row = this.installations.get(rowId);
    return row !== undefined && row.user_id === userId ? row.installation_id : null;
  }

  async replaceFindings(analysisId: string, userId: string, findings: readonly MaskedFinding[]) {
    this.findings = this.findings.filter((row) => row.analysis_id !== analysisId);
    this.findings.push(...findings.map((finding) => ({ ...finding, analysis_id: analysisId, user_id: userId })));
  }

  async replaceRecommendations(analysisId: string, userId: string, rows: readonly RecommendationInsert[]) {
    this.recommendations = this.recommendations.filter((row) => row.analysis_id !== analysisId);
    this.recommendations.push(...rows.map((row) => ({ ...row, analysis_id: analysisId, user_id: userId })));
  }

  async insertUsageEvent(event: UsageEventInsert): Promise<void> {
    this.usage.push(event);
  }
}

const encoder = new TextEncoder();

export function sha(i: number): string {
  return i.toString(16).padStart(40, "0");
}

export class FakeGitHub implements WorkerGitHub {
  /** path → content (string = UTF-8 text, Uint8Array = raw bytes). */
  files = new Map<string, string | Uint8Array>();
  /** Every call, for assertions. */
  calls: { op: string; args: unknown[] }[] = [];
  branchStatus = 200;
  /** Repo id GitHub returns for the name (null = 404). */
  repoId: number | null = REPO_ID;
  repoReadable = true;
  mintStatus = 200;
  treeStatus = 200;
  blobStatus = 200;

  constructor(files: Record<string, string | Uint8Array> = {}) {
    for (const [path, content] of Object.entries(files)) this.files.set(path, content);
  }

  private entries(): TreeBlobEntry[] {
    return [...this.files.entries()].map(([path, content], index) => ({
      path,
      sha: sha(index + 1),
      size: typeof content === "string" ? encoder.encode(content).length : content.length,
    }));
  }

  async mintToken(installationId: number): Promise<string> {
    this.calls.push({ op: "mint", args: [installationId] });
    if (this.mintStatus !== 200) throw new GitHubApiError("installation token", this.mintStatus);
    return "ghs_fake_installation_token";
  }

  async getBranchHeadSha(token: string, fullName: string, branch: string): Promise<string> {
    this.calls.push({ op: "branch", args: [fullName, branch] });
    if (this.branchStatus !== 200) throw new GitHubApiError("get branch", this.branchStatus);
    return HEAD;
  }

  async getRepoId(token: string, fullName: string): Promise<number | null> {
    this.calls.push({ op: "repoId", args: [fullName] });
    return this.repoId;
  }

  async isRepoReadable(token: string, fullName: string): Promise<boolean> {
    this.calls.push({ op: "repo", args: [fullName] });
    return this.repoReadable;
  }

  async getTreeBlobs(token: string, fullName: string, treeSha: string) {
    this.calls.push({ op: "tree", args: [fullName, treeSha] });
    if (this.treeStatus !== 200) throw new GitHubApiError("get tree", this.treeStatus);
    return { blobs: this.entries(), truncated: false };
  }

  async getBlob(token: string, fullName: string, blobSha: string): Promise<Uint8Array> {
    this.calls.push({ op: "blob", args: [fullName, blobSha] });
    if (this.blobStatus !== 200) throw new GitHubApiError("get blob", this.blobStatus);
    const entry = this.entries().find((item) => item.sha === blobSha);
    if (entry === undefined) throw new GitHubApiError("get blob", 404);
    const content = this.files.get(entry.path);
    if (content === undefined) throw new GitHubApiError("get blob", 404);
    return typeof content === "string" ? encoder.encode(content) : content;
  }

  blobPathsFetched(): string[] {
    const entries = this.entries();
    return this.calls
      .filter((call) => call.op === "blob")
      .map((call) => entries.find((entry) => entry.sha === call.args[1])?.path ?? "?");
  }
}
