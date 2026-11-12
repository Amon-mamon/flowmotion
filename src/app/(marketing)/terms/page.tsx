import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for Flow Motion during early testing.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="10 November 2026">
      <section>
        <h2>What Flow Motion does</h2>
        <p>
          Flow Motion reads the safe parts of a GitHub repository you connect, lists automations it
          can find, generates workflows from an allowed set of n8n nodes, simulates them with mock
          data inside Flow Motion, and exports n8n JSON. It does not run workflows for you and it
          never connects to your real services.
        </p>
      </section>
      <section>
        <h2>No guarantee that a flow works</h2>
        <p>
          A flow marked Valid has passed a structural check. A flow marked Simulated has passed
          mock-data test cases in Flow Motion. Behavior with your real credentials and services may
          differ. You are responsible for reviewing an exported flow, filling in the setup
          checklist, and testing it in your own n8n before relying on it.
        </p>
      </section>
      <section>
        <h2>Your repository</h2>
        <p>
          You must have the right to connect a repository. Flow Motion only reads it through the
          read-only GitHub App and never executes, installs, or builds anything from it. Content
          read from a repository is treated as data, never as instructions.
        </p>
      </section>
      <section>
        <h2>Early testing</h2>
        <p>
          Flow Motion is in early testing. There are no paid plans, prices, or credits. Abuse
          protection limits apply per account (a fixed number of analyses and generations per
          day). Features may change and the service may be unavailable at times.
        </p>
      </section>
      <section>
        <h2>Your data</h2>
        <p>
          How data is read, sent, stored, and deleted is described on the privacy page. Deleting a
          project deletes everything derived from it.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not use Flow Motion to analyze repositories you are not allowed to access, to
          circumvent its limits, or to attempt to extract other users&apos; data.
        </p>
      </section>
    </LegalPage>
  );
}
