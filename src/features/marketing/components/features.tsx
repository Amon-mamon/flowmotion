import { DownloadIcon, FolderSearchIcon, PlayIcon, WorkflowIcon } from "lucide-react";

import { Section } from "@/features/marketing/components/section";

const features = [
  {
    icon: FolderSearchIcon,
    title: "Repo scan",
    body: "Routes, webhooks, scheduled jobs, queue consumers, email and chat SDK usage, CI workflows: deterministic extractors find the signals before any model sees a redacted snippet.",
  },
  {
    icon: WorkflowIcon,
    title: "Node flows",
    body: "Every flow is built only from an allowed list of n8n nodes. Open the node canvas, click a node, and read its type, parameters, required credential, and source file.",
  },
  {
    icon: PlayIcon,
    title: "Simulation",
    body: "Flows run against mock data inside Flow Motion. The badge is honest: Valid means the file is structurally correct; Simulated means the logic passed mock-data cases.",
  },
  {
    icon: DownloadIcon,
    title: "n8n export",
    body: "Download importable n8n JSON with a setup checklist listing every credential and placeholder you must fill in. No secrets are ever written into the file.",
  },
] as const;

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="What you get"
      title="Built for inspection, not magic"
      description="Each piece shows its work so you can decide what to import."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
            <Icon aria-hidden="true" className="size-6 text-primary" />
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
