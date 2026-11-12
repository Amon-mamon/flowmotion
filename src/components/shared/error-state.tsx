"use client";

import { AlertCircleIcon } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, describeError } from "@/features/api/client";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
};

/** True when the error means the session is gone and the user must log in. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === "UNAUTHORIZED";
}

/** Error state for lists and pages: generic message plus retry, or a log-in link on 401. */
export function ErrorState({ title = "Could not load", error, onRetry, className }: ErrorStateProps) {
  const unauthorized = isUnauthorized(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-primary bg-card px-6 py-10 text-center",
        className,
      )}
    >
      <AlertCircleIcon aria-hidden="true" className="size-6 text-primary" />
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{describeError(error)}</p>
      {unauthorized ? (
        <Link href="/login" className={cn(buttonVariants({ variant: "default" }))}>
          Sign in again
        </Link>
      ) : onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
