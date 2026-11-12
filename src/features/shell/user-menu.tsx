"use client";

import { ChevronsUpDownIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/api/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/features/auth/queries";
import { useProfile } from "@/features/profile/queries";

export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const profile = useProfile();
  const signOut = useSignOut();

  if (profile.isPending) {
    return (
      <div className="flex items-center gap-3 px-2 py-2" aria-busy="true" aria-label="Loading account">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  const name = profile.data?.displayName ?? profile.data?.email ?? "Account";

  return (
    <div className="flex flex-col gap-1">
    {signOut.isPending ? (
      <p role="status" className="px-2 text-xs text-muted-foreground">
        Signing out…
      </p>
    ) : null}
    {signOut.isError ? (
      <p role="alert" className="px-2 text-xs text-primary">
        Could not sign out. {describeError(signOut.error)}
      </p>
    ) : null}
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-sidebar-accent"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary"
        >
          <UserIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <ChevronsUpDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{profile.data?.email ?? "Signed in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/settings" onClick={onNavigate} />}
        >
          <SettingsIcon aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          <LogOutIcon aria-hidden="true" />
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );
}
