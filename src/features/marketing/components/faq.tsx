import { ChevronDownIcon } from "lucide-react";

import { Section } from "@/features/marketing/components/section";

const faqs = [
  {
    q: "Does Flow Motion run my workflows?",
    a: "No. It generates flows, simulates them with mock data, and exports n8n JSON. You import and run them in your own n8n.",
  },
  {
    q: "What does the Simulated badge mean?",
    a: "Simulated with mock data in Flow Motion. Behavior with your real credentials and services may differ. Valid means only that the exported file is structurally correct.",
  },
  {
    q: "Which files are read?",
    a: "Source files, manifests, framework configs, route handlers, CI workflows, schema files, and README files, within size and count limits. Env files, keys, credentials, lockfiles, and build output are never opened.",
  },
  {
    q: "Is my source code stored?",
    a: "No. Files are read during an analysis and discarded when it ends. Only derived results are kept: masked findings, recommendations, and generated flows.",
  },
  {
    q: "Is anything sent to an AI provider?",
    a: "Yes. Redacted snippets of the files that were read, with secrets replaced by a placeholder, are sent to the AI provider to produce recommendations and flows.",
  },
  {
    q: "What if my repository is not a website or app?",
    a: "The validity check stops the analysis and tells you why. Nothing is sent to the AI provider in that case.",
  },
] as const;

export function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions people ask first">
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {faqs.map(({ q, a }) => (
          <details key={q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-base font-medium focus-visible:outline-2 focus-visible:outline-ring">
              {q}
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
