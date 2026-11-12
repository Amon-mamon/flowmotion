"use client";

import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { InstallationsList } from "@/features/github/components/installations-list";
import { DisplayNameForm } from "@/features/profile/components/display-name-form";
import { useProfile } from "@/features/profile/queries";

export function SettingsView() {
  const profile = useProfile();

  return (
    <>
      <PageHeader title="Settings" description="Your profile and connected GitHub installations." />

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Profile
        </h2>
        {profile.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading profile" className="flex max-w-md flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-20" />
          </div>
        ) : profile.isError ? (
          <ErrorState
            title="Could not load profile"
            error={profile.error}
            onRetry={() => void profile.refetch()}
          />
        ) : (
          <DisplayNameForm key={profile.data.id} profile={profile.data} />
        )}
      </section>

      <section aria-labelledby="github-heading" className="flex flex-col gap-4">
        <h2 id="github-heading" className="text-lg font-semibold">
          GitHub
        </h2>
        <InstallationsList />
      </section>
    </>
  );
}
