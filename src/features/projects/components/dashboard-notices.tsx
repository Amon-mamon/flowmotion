"use client";

import { AlertCircleIcon, CheckCircle2Icon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { useInstallations } from "@/features/github/queries";
import { cn } from "@/lib/utils";

/** Notices after the GitHub installation callback (docs/design.md). */
export function DashboardNotices() {
  const params = useSearchParams();

  if (params.get("connected") === "1") {
    return <ConnectedNotice />;
  }
  if (params.get("link") === "github") {
    return (
      <Alert role="status" data-notice="link-github">
        <LinkIcon aria-hidden="true" />
        <AlertDescription>
          <p>Flow Motion was installed or updated on GitHub. Link it to your account to continue.</p>
          {/* Plain anchor: this route redirects to GitHub and must not be prefetched. */}
          <a href="/api/github/authorize" className={cn(buttonVariants({ size: "sm" }), "mt-2 no-underline")}>
            Link existing installation
          </a>
        </AlertDescription>
      </Alert>
    );
  }
  if (params.get("error") === "github_account") {
    return (
      <Alert variant="destructive" data-notice="github-account">
        <AlertCircleIcon aria-hidden="true" />
        <AlertDescription>
          You are signed in to GitHub with a different account than the one linked to Flow Motion. Switch
          accounts on GitHub, or disconnect the linked installations in Settings first.{" "}
          <Link href="/settings">Settings</Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (params.get("error") === "github") {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertDescription>Could not connect GitHub. Try again.</AlertDescription>
      </Alert>
    );
  }
  if (params.get("error") === "github_none") {
    return (
      <Alert variant="destructive" data-notice="github-none">
        <AlertCircleIcon aria-hidden="true" />
        <AlertDescription>
          Flow Motion is not installed on any GitHub account you can access. Install it first.{" "}
          {/* Plain anchor: this route redirects to GitHub and must not be prefetched. */}
          <a href="/api/github/install">Connect GitHub</a>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** `?connected=1`: names the GitHub account (first non-null login), else plain (design.md). */
function ConnectedNotice() {
  const installations = useInstallations();
  const login = installations.data?.find((i) => i.githubUserLogin !== null)?.githubUserLogin ?? null;
  return (
    <Alert role="status" data-notice="connected">
      <CheckCircle2Icon aria-hidden="true" />
      <AlertDescription>{login ? `GitHub connected as @${login}` : "GitHub connected"}</AlertDescription>
    </Alert>
  );
}
