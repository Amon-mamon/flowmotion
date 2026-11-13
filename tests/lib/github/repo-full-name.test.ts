// @vitest-environment node
/** S11-4 / D-23: repo full names are user input. */
import { describe, expect, it } from "vitest";

import { branchesQuerySchema, isValidRepoFullName, repoFullNameSchema } from "@/schemas/github";
import { createProjectBodySchema } from "@/schemas/project";

describe("repoFullNameSchema", () => {
  it.each(["octo-org/my.repo_1", "octo/site", "a/b", "A-1/.github", "o/a..b"])("accepts %j", (name) => {
    expect(repoFullNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    "./x",
    "../x",
    "x/..",
    "x/.",
    "../meta",
    "a b/c",
    "a_b/c",
    "a.b/c",
    "octo",
    "octo/",
    "/site",
    "a/b/c",
    "octo/si te",
    `o/${"x".repeat(139)}`,
  ])("rejects %j", (name) => {
    expect(isValidRepoFullName(name)).toBe(false);
    expect(repoFullNameSchema.safeParse(name).success).toBe(false);
  });

  it("applies to the branches query and the create body", () => {
    expect(branchesQuerySchema.safeParse({ repo: "../meta" }).success).toBe(false);
    expect(
      createProjectBodySchema.safeParse({
        repoFullName: "octo/..",
        installationId: "11111111-1111-4111-8111-111111111111",
        branch: "main",
      }).success,
    ).toBe(false);
  });
});
