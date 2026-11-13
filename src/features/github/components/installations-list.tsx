"use client";

import { ExternalLinkIcon, GitBranchIcon, PlusIcon, UnplugIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/api/client";
import { RefreshAccessLink } from "@/features/github/components/refresh-access-notice";
import { useDisconnectInstallation, useInstallations } from "@/features/github/queries";
import type { Installation } from "@/features/github/schemas";
import { formatDate } from "@/hooks/use-format-date";
import { cn } from "@/lib/utils";

export function InstallationsList() {
  const installations = useInstallations();

  if (installations.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading installations" className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (installations.isError) {
    return (
      <ErrorState
        title="Could not load installations"
        error={installations.error}
        onRetry={() => void installations.refetch()}
      />
    );
  }

  if (installations.data.length === 0) {
    return (
      <EmptyState
        icon={<GitBranchIcon />}
        title="No GitHub installation connected"
        description="Connect GitHub to add repositories."
        action={
          <div className="flex flex-col items-center gap-3">
            <a href="/api/github/install" className={cn(buttonVariants({ variant: "default" }))}>
              Connect GitHub
            </a>
            <a href="/api/github/authorize" className="text-sm text-primary underline-offset-4 hover:underline">
              Link existing installation
            </a>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2" aria-label="Connected GitHub installations">
        {installations.data.map((installation) => (
          <InstallationRow key={installation.id} installation={installation} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        {/* Plain anchors: these routes redirect to GitHub and must not be prefetched. */}
        <a href="/api/github/install" className={cn(buttonVariants({ variant: "outline" }))}>
          <PlusIcon aria-hidden="true" />
          Connect another account
        </a>
        <a href="/api/github/authorize" className="text-sm text-primary underline-offset-4 hover:underline">
          Link existing installation
        </a>
      </div>
    </div>
  );
}

function InstallationRow({ installation }: { installation: Installation }) {
  const disconnect = useDisconnectInstallation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    disconnect.mutate(installation.id, {
      onSuccess: () => setOpen(false),
      onError: (err) => setError(describeError(err)),
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <GitBranchIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{installation.accountLogin}</p>
            {installation.needsRefresh ? <Badge variant="outline">Needs refresh</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">Connected {formatDate(installation.createdAt)}</p>
          {installation.githubUserLogin ? (
            <p className="text-xs text-muted-foreground">Linked as @{installation.githubUserLogin}</p>
          ) : null}
          {installation.needsRefresh ? (
            <RefreshAccessLink className="text-xs text-primary underline-offset-4 hover:underline" />
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`https://github.com/settings/installations/${installation.installationId}`}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Manage on GitHub
          <ExternalLinkIcon aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (disconnect.isPending) return;
            if (!next) setError(null);
            setOpen(next);
          }}
        >
          <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
            <UnplugIcon aria-hidden="true" />
            Disconnect
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {installation.accountLogin}?</AlertDialogTitle>
              <AlertDialogDescription>
                Projects from this installation keep their results, but they need a reconnect
                before they can be analyzed again. To remove the app from GitHub as well, use
                Manage on GitHub.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <p role="alert" className="text-sm text-primary">
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={confirm} disabled={disconnect.isPending}>
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
