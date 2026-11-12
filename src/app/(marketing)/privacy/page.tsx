import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Flow Motion reads, what it sends to the AI provider, and what it stores.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="10 November 2026">
      <section>
        <h2>What Flow Motion reads</h2>
        <p>
          Flow Motion connects to the repositories you choose through a read-only GitHub App with
          the Contents and Metadata permissions only. It cannot write to your repository and it
          never asks for broad OAuth scopes.
        </p>
        <p>
          Before any file is fetched, a path policy denies secret files and sensitive paths (env
          files, keys, certificates, credentials, cloud configuration, lockfiles, build output,
          binaries). Those files are never opened. Only their existence may be reported as a masked
          finding.
        </p>
      </section>
      <section>
        <h2>What is sent to the AI provider</h2>
        <p>
          Redacted snippets of your code are sent to the AI provider to produce recommendations
          and flows. A secret scanner runs on every file that is read; anything that looks like a
          secret is replaced with a placeholder before the text is sent. The provider receives
          only the files that passed the path policy, within the size and token limits of one
          analysis.
        </p>
        <p>
          Projects that fail the validity check (not a website or app project) are stopped before
          anything is sent to the AI provider.
        </p>
      </section>
      <section>
        <h2>What is stored</h2>
        <p>No source code is stored. Files are read during an analysis and discarded when it ends.</p>
        <p>Flow Motion keeps only derived results:</p>
        <ul>
          <li>security findings with masked evidence (never the raw secret)</li>
          <li>automation recommendations</li>
          <li>generated flows, their test results, and setup checklists</li>
          <li>counts and error codes about each analysis, for example how many files were skipped</li>
          <li>your account email and display name, and the GitHub installation ids you connected</li>
        </ul>
      </section>
      <section>
        <h2>Deleting your data</h2>
        <p>
          Deleting a project removes its analyses, findings, recommendations, flows, and test runs.
          Disconnecting a GitHub installation removes the link to that installation; existing
          project results stay until you delete the project.
        </p>
      </section>
      <section>
        <h2>Logging</h2>
        <p>
          Server logs contain ids, counts, and error codes. They never contain file contents,
          model prompts, or model outputs that include repository text.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          Flow Motion is in early testing. This page is updated whenever what is read, sent, or
          stored changes. The AI provider&apos;s data retention terms are being confirmed; this
          page will state them before public launch.
        </p>
      </section>
    </LegalPage>
  );
}
