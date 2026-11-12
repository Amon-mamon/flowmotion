import { CheckIcon } from "lucide-react";
import Link from "next/link";

import { Section } from "@/features/marketing/components/section";

const points = [
  "Read-only GitHub App with Contents and Metadata permissions only. No write access, no broad OAuth tokens.",
  "A path policy runs before any fetch: env files, keys, certificates, credentials, and lockfiles are never opened.",
  "A secret scanner runs on every file that is read. Matches are masked in findings and redacted before anything is sent onward.",
  "Redacted snippets are sent to the AI provider for analysis. No source code is stored; only derived results are kept.",
  "Deleting a project deletes its analyses, findings, recommendations, flows, and test runs.",
  "Exports never contain secrets or credential ids. The setup checklist tells you what to fill in yourself.",
] as const;

export function Security() {
  return (
    <Section
      id="security"
      eyebrow="Security"
      title="Flow Motion reads other people's code, so it reads carefully"
      description="These rules are enforced in code and reviewed before every release."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {points.map((point) => (
          <li key={point} className="flex gap-3 rounded-xl border border-border bg-card p-5 text-sm">
            <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">{point}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        The full wording is on the{" "}
        <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
          privacy page
        </Link>
        .
      </p>
    </Section>
  );
}
