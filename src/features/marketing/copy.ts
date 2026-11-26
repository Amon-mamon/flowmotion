/**
 * Every landing page string, exact copy from docs/design.md "Landing page"
 * (D-55). Components read only from here; change wording only through the
 * architect. Mono labels are written in source case and uppercased by CSS.
 */

export { PLANS_BODY, PLANS_HEADING } from "@/features/marketing/components/plans-coming-soon";

export const COMING_SOON = "Coming soon";

export const HEADER = {
  navLabel: "Main",
  nav: [
    { label: "How it works", anchor: "how-it-works" },
    { label: "Security", anchor: "security" },
    { label: "FAQ", anchor: "faq" },
  ],
  login: { label: "Log in", href: "/login" },
  getStarted: { label: "Get started", href: "/signup" },
} as const;

export const HERO = {
  tag: "Read-only GitHub access",
  heading: "Turn your repository into working n8n automations.",
  lead: "Flow Motion reads your code safely, finds what to automate, and builds the workflows for you.",
  primary: { label: "Get started", href: "/signup" },
  secondary: { label: "See how it works", href: "#how-it-works" },
  framePath: "example/storefront · main",
} as const;

/** The fact strip, in order. `comingSoon` marks the one gated by isFlowGenerationLive(). */
export const FACTS = [
  { label: "Reads only safe files", comingSoon: false },
  { label: "Secrets masked before any AI call", comingSoon: false },
  { label: "32 supported n8n nodes", comingSoon: false },
  { label: "Exports n8n-ready JSON", comingSoon: true },
] as const;

export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  heading: "From repository to workflow in four steps",
  lead: "Every step shows what was read, what was skipped, and what was produced.",
  steps: [
    {
      key: "connect",
      label: "01 / Connect",
      title: "Connect a repository",
      body: "Install the read-only GitHub App and choose a repository and branch. Flow Motion first checks that it is a real website or app. If it is not, it stops and tells you why, before any AI is used.",
      comingSoon: false,
    },
    {
      key: "scan",
      label: "02 / Scan",
      title: "Scan safely",
      body: "Secret files such as env files and private keys are never opened. Every file that is read is checked for secrets, and anything found is masked before an AI sees the code.",
      comingSoon: false,
    },
    {
      key: "recommend",
      label: "03 / Recommend",
      title: "Pick what to automate",
      body: "Flow Motion lists the automations it finds, such as webhooks, scheduled jobs, and notifications, each with its source files, the credentials it needs, and a risk level.",
      comingSoon: false,
    },
    {
      key: "generate",
      label: "04 / Generate",
      title: "Generate and export",
      body: "Each pick becomes a workflow built only from 32 allowed n8n nodes. Inspect every node on a visual graph, then download n8n JSON with a checklist of what to fill in.",
      comingSoon: true,
    },
  ],
} as const;

export type StepKey = (typeof HOW_IT_WORKS.steps)[number]["key"];

export const FEATURES = {
  eyebrow: "What you get",
  heading: "Built to show its work",
  lead: "Every result comes with the files and reasons behind it, so you decide what to import.",
  graphs: {
    title: "Readable node graphs",
    body: "Every flow is a graph you can inspect node by node: its type, parameters, the credential it needs, and the source files it came from.",
    comingSoon: true,
  },
  findings: {
    title: "Security findings, masked",
    body: "Committed env files, hardcoded keys, and leaked tokens are reported with the file and line. The secret itself is never shown.",
    comingSoon: false,
  },
  recommendations: {
    title: "Recommendations with reasons",
    body: "Each automation comes with a confidence score, a risk level, and the files that led to it.",
    comingSoon: false,
  },
  export: {
    title: "n8n JSON export",
    body: "Download a file n8n can import, plus a checklist of the credentials and values to fill in. No secrets are ever written into it.",
    comingSoon: true,
  },
} as const;

export const SECURITY = {
  eyebrow: "Security",
  heading: "Careful with your code by design",
  lead: "These rules are enforced in code, not left to the AI.",
  guarantees: [
    {
      title: "Read-only GitHub access",
      body: "The GitHub App asks only to read contents and metadata. It cannot push code, open pull requests, or change settings.",
    },
    {
      title: "Secret files are never opened",
      body: "A deny list runs before any file is fetched, so env files, private keys, and credential files are skipped.",
    },
    {
      title: "Your code is never run",
      body: "Flow Motion reads files as text. It never installs, builds, or executes anything from your repository.",
    },
    {
      title: "Secrets are masked before any AI call",
      body: "Every file that is read is scanned. Secrets are masked in findings and removed before anything is sent to the AI provider. No source code is stored.",
    },
    {
      title: "Delete means delete",
      body: "Deleting a project removes its analyses, findings, recommendations, and flows.",
    },
  ],
  privacyLink: { label: "Read the privacy page", href: "/privacy" },
  framePath: "Security findings",
  exampleTag: "Example",
} as const;

export const FAQ = {
  eyebrow: "FAQ",
  heading: "Questions people ask first",
  items: [
    {
      q: "Does Flow Motion run my workflows?",
      a: "No. Flow Motion generates workflows and exports them as n8n JSON. You import and run them in your own n8n.",
    },
    {
      q: "Does Flow Motion get write access to my GitHub?",
      a: "No. The GitHub App asks only to read contents and metadata, and only for the repositories you choose when you install it.",
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
    {
      q: "Which n8n nodes can a flow use?",
      a: "Only the 32 nodes on Flow Motion's allowed list, such as Webhook, Schedule Trigger, HTTP Request, Slack, Gmail, and Postgres. Code nodes are never used, so every flow can be checked before you export it.",
    },
    {
      q: "Can I edit a flow before exporting it?",
      a: "Not in Flow Motion yet. You can inspect every node, then change anything you like in n8n after you import the file.",
    },
  ],
} as const;

export const FINAL_CTA = {
  heading: "See what your repository can automate.",
  body: "Connect a repository and get a list of automations you can build, with the files behind each one.",
  primary: { label: "Get started", href: "/signup" },
  secondary: { label: "Log in", href: "/login" },
} as const;

export const FOOTER = {
  tagline: "Generates and exports n8n flows. Does not run them for you.",
  navLabel: "Legal",
  links: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
  disclaimer: "Flow Motion is not affiliated with n8n.",
} as const;

/** Page metadata for `/` (kept honest: no simulation claim, D-55). */
export const LANDING_META = {
  description:
    "Connect a GitHub repository with read-only access. Flow Motion reads only safe files, masks secrets, and recommends n8n automations with the files behind each one.",
} as const;
