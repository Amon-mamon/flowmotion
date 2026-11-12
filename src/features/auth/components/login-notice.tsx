"use client";

import { AlertCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";

/** Shows the `?error=auth` notice set by `GET /api/auth/callback`. */
export function LoginNotice() {
  const params = useSearchParams();
  if (params.get("error") !== "auth") return null;
  return (
    <Alert variant="destructive" className="mb-6">
      <AlertCircleIcon aria-hidden="true" />
      <AlertDescription>Could not complete sign-in. Try again.</AlertDescription>
    </Alert>
  );
}
