import { BanIcon, CheckCircle2Icon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Validation } from "@/features/analysis/schemas";

/** Validity result: kind when valid; the reason as plain text when invalid (analysis stops). */
export function ValidationResult({ validation }: { validation: Validation | null }) {
  if (validation === null) return null;

  if (validation.kind === "invalid") {
    return (
      <Alert variant="destructive" data-validation="invalid">
        <BanIcon aria-hidden="true" />
        <AlertTitle>This repository was not recognized as a website or app</AlertTitle>
        <AlertDescription>
          <p>{validation.reason ?? "No website or app framework was found."}</p>
          <p>The analysis stopped here. No files were read and no AI was used.</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section
      aria-label="Validation result"
      data-validation={validation.kind}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"
    >
      <CheckCircle2Icon aria-hidden="true" className="size-4 text-primary" />
      <span>
        Recognized as {validation.kind === "app" ? "an app" : "a website"} project.
      </span>
    </section>
  );
}
