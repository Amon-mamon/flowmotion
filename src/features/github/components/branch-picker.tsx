"use client";

import { GitBranchIcon, LockIcon } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/api/client";
import { RefreshAccessNotice, isRefreshRequired } from "@/features/github/components/refresh-access-notice";
import { useRepoBranches } from "@/features/github/queries";
import type { Branch, Repo } from "@/features/github/schemas";
import { useCreateProject } from "@/features/projects/queries";
import type { Project } from "@/features/projects/schemas";
import { cn } from "@/lib/utils";

type BranchPickerProps = {
  installationId: string;
  repo: Repo;
  onBack: () => void;
  onCreated: (project: Project) => void;
};

type Row = { name: string; protected: boolean | null; isDefault: boolean };

/**
 * Builds the visible rows: the default branch pinned first (even before it
 * appears in a loaded page, never twice), then loaded branches in GitHub order.
 * The filter never hides the selected branch (review R11-9): a selected row
 * that does not match stays visible, so the submitted branch is always shown.
 */
export function branchRows(
  defaultBranch: string,
  loaded: Branch[],
  filter: string,
  selected: string | null = null,
): Row[] {
  const fromList = loaded.find((b) => b.name === defaultBranch);
  const rows: Row[] = [
    { name: defaultBranch, protected: fromList ? fromList.protected : null, isDefault: true },
    ...loaded.filter((b) => b.name !== defaultBranch).map((b) => ({ ...b, isDefault: false })),
  ];
  const needle = filter.trim().toLowerCase();
  return needle ? rows.filter((r) => r.name === selected || r.name.toLowerCase().includes(needle)) : rows;
}

/** Step 2 of "Add repository": choose a branch, then `POST /api/projects` (design.md). */
export function BranchPicker({ installationId, repo, onBack, onCreated }: BranchPickerProps) {
  const branches = useRepoBranches(installationId, repo.fullName);
  const create = useCreateProject();
  const [filter, setFilter] = useState("");
  const loadedDefault = branches.data?.pages[0]?.defaultBranch;
  const defaultBranch = loadedDefault ?? repo.defaultBranch;
  const [selected, setSelected] = useState<string | null>(null);
  // Preselect the default branch until the user picks another one.
  const effectiveSelected = selected ?? defaultBranch;
  const filterId = useId();

  const loaded = branches.data?.pages.flatMap((page) => page.branches) ?? [];
  const rows = branchRows(defaultBranch, loaded, filter, effectiveSelected);
  // "No loaded branch matches" refers to the filter, ignoring the always-visible selection.
  const filterMatches = rows.some(
    (r) => !filter.trim() || r.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function submit() {
    create.mutate(
      { repoFullName: repo.fullName, installationId, branch: effectiveSelected },
      { onSuccess: onCreated },
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="truncate font-mono text-sm" data-testid="selected-repo">
        {repo.fullName}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={filterId}>Search branches</Label>
        <Input
          id={filterId}
          type="search"
          placeholder="Filter loaded branches"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoComplete="off"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Branch</legend>
        {branches.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading branches" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : branches.isError && isRefreshRequired(branches.error) ? (
          <RefreshAccessNotice />
        ) : branches.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-primary px-3 py-4 text-sm">
            <p>Could not load branches. Try again.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void branches.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {!filterMatches ? (
              <p role="status" className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                No loaded branch matches. Load more branches or check the name.
              </p>
            ) : null}
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
              {rows.map((row) => {
                const checked = effectiveSelected === row.name;
                return (
                  <li key={row.name} data-branch={row.name}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                        checked && "bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="branch"
                        value={row.name}
                        checked={checked}
                        onChange={() => {
                          setSelected(row.name);
                          create.reset();
                        }}
                        className="accent-primary"
                      />
                      <GitBranchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono">{row.name}</span>
                      {row.isDefault ? <Badge variant="outline">default</Badge> : null}
                      {row.protected ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon aria-hidden="true" className="size-3.5" />
                          Protected
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {branches.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void branches.fetchNextPage()}
            disabled={branches.isFetchingNextPage}
            className="self-start"
          >
            {branches.isFetchingNextPage ? "Loading…" : "Load more branches"}
          </Button>
        ) : null}
      </fieldset>

      {create.isError && isRefreshRequired(create.error) ? (
        <RefreshAccessNotice />
      ) : create.isError ? (
        <p role="alert" className="text-sm text-primary">
          {describeError(create.error)}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onBack} disabled={create.isPending}>
          Back
        </Button>
        <Button type="submit" disabled={!effectiveSelected || create.isPending}>
          {create.isPending ? "Adding…" : "Add repository"}
        </Button>
      </div>
    </form>
  );
}
