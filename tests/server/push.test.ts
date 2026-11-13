// @vitest-environment node
/**
 * Webhook `push` → stale matching (contract section 6, Phase 1.1 item 7):
 * only `refs/heads/<projects.branch>`, never the default branch.
 */
import { describe, expect, it } from "vitest";

import { planPushUpdates, type PushCandidate } from "@/server/github/push";
import type { GhWebhookPushEvent } from "@/schemas/github";

const AFTER = "d".repeat(40);
const P_MAIN = "11111111-1111-4111-8111-111111111111";
const P_FEATURE = "22222222-2222-4222-8222-222222222222";
const P_OTHER_REPO = "33333333-3333-4333-8333-333333333333";
const P_PENDING = "44444444-4444-4444-8444-444444444444";

const candidates: PushCandidate[] = [
  { id: P_MAIN, repo_full_name: "Octo/Site", branch: "main", status: "valid" },
  { id: P_FEATURE, repo_full_name: "octo/site", branch: "feature/x", status: "invalid" },
  { id: P_OTHER_REPO, repo_full_name: "octo/other", branch: "main", status: "valid" },
];

function push(ref: string, extra: Partial<GhWebhookPushEvent> = {}): GhWebhookPushEvent {
  return {
    ref,
    after: AFTER,
    repository: { full_name: "octo/site" },
    installation: { id: 4242 },
    ...extra,
  };
}

describe("planPushUpdates", () => {
  it("push to the chosen branch marks only that project stale (repo name case-insensitive)", () => {
    expect(planPushUpdates(push("refs/heads/main"), candidates)).toEqual([
      { id: P_MAIN, last_commit_sha: AFTER, stale: true },
    ]);
  });

  it("two projects of one repo on different branches are matched independently", () => {
    expect(planPushUpdates(push("refs/heads/feature/x"), candidates)).toEqual([
      { id: P_FEATURE, last_commit_sha: AFTER, stale: true },
    ]);
  });

  it("push to a branch no project chose changes nothing (even the repo default)", () => {
    expect(planPushUpdates(push("refs/heads/develop"), candidates)).toEqual([]);
    expect(planPushUpdates(push("refs/tags/main"), candidates)).toEqual([]);
  });

  it("branch match is case-sensitive", () => {
    expect(planPushUpdates(push("refs/heads/Main"), candidates)).toEqual([]);
  });

  it("pending project: last_commit_sha set, not stale", () => {
    const list: PushCandidate[] = [{ id: P_PENDING, repo_full_name: "octo/site", branch: "main", status: "pending" }];
    expect(planPushUpdates(push("refs/heads/main"), list)).toEqual([{ id: P_PENDING, last_commit_sha: AFTER }]);
  });

  it("ignored when deleted or when after is not 40 hex chars", () => {
    expect(planPushUpdates(push("refs/heads/main", { deleted: true }), candidates)).toEqual([]);
    expect(planPushUpdates(push("refs/heads/main", { after: "0".repeat(39) }), candidates)).toEqual([]);
    expect(planPushUpdates(push("refs/heads/main", { after: "Z".repeat(40) }), candidates)).toEqual([]);
  });
});
