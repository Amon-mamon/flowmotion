"use client";

import { LockIcon } from "lucide-react";
import { useId, useState } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchPicker } from "@/features/github/components/branch-picker";
import {
  RefreshAccessLink,
  RefreshAccessNotice,
  isRefreshRequired,
} from "@/features/github/components/refresh-access-notice";
import { useInstallationRepos, useInstallations } from "@/features/github/queries";
import type { Repo } from "@/features/github/schemas";
import type { Project } from "@/features/projects/schemas";
import { cn } from "@/lib/utils";

export type RepoPickerStep = "repo" | "branch";

type RepoPickerProps = {
  onCreated: (project: Project) => void;
  onCancel: () => void;
  /** Lets the dialog switch its title and description per step. */
  onStepChange?: (step: RepoPickerStep) => void;
};

/**
 * Two-step repo picker (design.md "Add repository"): step 1 chooses an
 * installation and a repo (paged on `hasMore`); step 2 chooses a branch and
 * confirms with `POST /api/projects { repoFullName, installationId, branch }`.
 */
export function RepoPicker({ onCreated, onCancel, onStepChange }: RepoPickerProps) {
  const installations = useInstallations();
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [step, setStepState] = useState<RepoPickerStep>("repo");
  const selectId = useId();

  function setStep(next: RepoPickerStep) {
    setStepState(next);
    onStepChange?.(next);
  }

  // Default to the first installation once loaded.
  const effectiveInstallationId =
    installationId ?? installations.data?.[0]?.id ?? null;
  const selectedInstallation =
    installations.data?.find((installation) => installation.id === effectiveInstallationId) ?? null;

  const repos = useInstallationRepos(effectiveInstallationId);

  if (installations.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading installations" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (installations.isError) {
    return (
      <ErrorState
        title="Could not load GitHub installations"
        error={installations.error}
        onRetry={() => void installations.refetch()}
      />
    );
  }

  if (installations.data.length === 0) {
    return (
      <div role="status" className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">
          No GitHub installation is connected yet. Connect GitHub to pick a repository.
        </p>
        <a href="/api/github/install" className={cn(buttonVariants({ variant: "default" }))}>
          Connect GitHub
        </a>
        <a href="/api/github/authorize" className="text-sm text-primary underline-offset-4 hover:underline">
          Link existing installation
        </a>
      </div>
    );
  }

  const allRepos = repos.data?.pages.flatMap((page) => page.repos) ?? [];

  if (step === "branch" && selectedRepo && effectiveInstallationId) {
    return (
      <BranchPicker
        installationId={effectiveInstallationId}
        repo={selectedRepo}
        onBack={() => setStep("repo")}
        onCreated={onCreated}
      />
    );
  }

  function next() {
    if (selectedRepo && effectiveInstallationId) setStep("branch");
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId}>GitHub account</Label>
        <select
          id={selectId}
          value={effectiveInstallationId ?? ""}
          onChange={(event) => {
            setInstallationId(event.target.value);
            setSelectedRepo(null);
          }}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {installations.data.map((installation) => (
            <option key={installation.id} value={installation.id} className="bg-popover text-foreground">
              {installation.accountLogin}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Repository</legend>
        {repos.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading repositories" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : repos.isError && isRefreshRequired(repos.error) ? (
          <RefreshAccessNotice />
        ) : repos.isError ? (
          <ErrorState
            title="Could not load repositories"
            error={repos.error}
            onRetry={() => void repos.refetch()}
            className="py-6"
          />
        ) : allRepos.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No repositories in this installation.{" "}
            {selectedInstallation ? (
              <a
                href={`https://github.com/settings/installations/${selectedInstallation.installationId}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline-offset-4 hover:underline"
              >
                Grant access to repositories on GitHub
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              "Grant access to repositories on GitHub"
            )}
            , then try again.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
            {allRepos.map((repo) => {
              const checked = selectedRepo?.fullName === repo.fullName;
              return (
                <li key={repo.fullName}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      checked && "bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="repo"
                      value={repo.fullName}
                      checked={checked}
                      onChange={() => {
                        setSelectedRepo(repo);
                      }}
                      className="accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
                    <span className="font-mono text-xs text-muted-foreground">{repo.defaultBranch}</span>
                    {repo.private ? (
                      <LockIcon aria-label="Private" className="size-3.5 text-muted-foreground" />
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {repos.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void repos.fetchNextPage()}
            disabled={repos.isFetchingNextPage}
            className="self-start"
          >
            {repos.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-col gap-1 sm:mr-auto">
          {/* Plain anchors: these routes redirect to GitHub and must not be prefetched. */}
          <a href="/api/github/authorize" className="text-sm text-primary underline-offset-4 hover:underline">
            Link existing installation
          </a>
          <p className="text-sm text-muted-foreground" data-testid="missing-repo">
            Missing a repository? <RefreshAccessLink />
          </p>
          <a href="/api/github/install" className="text-sm text-primary underline-offset-4 hover:underline">
            Connect another account
          </a>
        </div>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!selectedRepo}>
          Next
        </Button>
      </div>
    </form>
  );
}
