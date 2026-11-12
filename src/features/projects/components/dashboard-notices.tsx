"use client";

import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";

/** Notices after the GitHub installation callback (docs/design.md). */
export function DashboardNotices() {
  const params = useSearchParams();

  if (params.get("connected") === "1") {
    return (
      <Alert role="status">
        <CheckCircle2Icon aria-hidden="true" />
        <AlertDescription>GitHub connected</AlertDescription>
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
  return null;
}
