"use client";

import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/features/api/client";
import { FLOW_COPY, downloadErrorText, importNotVerifiedText, usedByText } from "@/features/flows/copy";
import { downloadFlowExport } from "@/features/flows/queries";
import type { FlowDetail, SetupChecklist } from "@/features/flows/schemas";

const EMPTY_CHECKLIST: SetupChecklist = { credentials: [], placeholders: [], warnings: [] };

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" data-checklist={id}>
      <h4 id={`export-${id}`} className="text-sm font-medium">
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * Export panel (design.md): the setup checklist built by the compiler, the
 * "not yet verified" notice, and the n8n JSON download. Shown for `ready`
 * flows only. Flow Motion exports flows; it does not run them.
 */
export function ExportPanel({
  flow,
}: {
  flow: Pick<FlowDetail, "id" | "checklist" | "importVerified" | "n8nVersion">;
}) {
  const checklist = flow.checklist ?? EMPTY_CHECKLIST;
  const download = useMutation({ mutationFn: () => downloadFlowExport(flow.id) });
  const errorCode = download.error instanceof ApiError ? download.error.code : null;

  return (
    <section
      aria-labelledby="export-heading"
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="export-heading" className="text-lg font-semibold">
          {FLOW_COPY.exportHeading}
        </h2>
        <h3 className="text-sm text-muted-foreground">{FLOW_COPY.exportSubheading}</h3>
      </div>

      <Group id="credentials" title={FLOW_COPY.credentialsHeading}>
        {checklist.credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">{FLOW_COPY.noCredentials}</p>
        ) : (
          <ul aria-labelledby="export-credentials" className="flex flex-col gap-1.5 text-sm">
            {checklist.credentials.map((credential) => {
              const usedBy = usedByText(credential.usedBy);
              return (
                <li key={credential.name}>
                  {credential.name}
                  {usedBy === null ? null : `, ${usedBy}`}
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group id="placeholders" title={FLOW_COPY.placeholdersHeading}>
        {checklist.placeholders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{FLOW_COPY.noPlaceholders}</p>
        ) : (
          <ul aria-labelledby="export-placeholders" className="flex flex-col gap-1.5 text-sm">
            {checklist.placeholders.map((placeholder) => {
              const usedBy = usedByText(placeholder.usedBy);
              return (
                <li key={placeholder.name}>
                  <span className="font-mono text-xs break-all">{placeholder.name}</span>
                  {usedBy === null ? null : (
                    <>
                      {" "}
                      <span className="text-muted-foreground">{usedBy}</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group id="warnings" title={FLOW_COPY.warningsHeading}>
        <ul aria-labelledby="export-warnings" className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {checklist.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </Group>

      {flow.importVerified ? null : (
        <div
          role="note"
          data-notice="import-not-verified"
          className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-sm"
        >
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>{importNotVerifiedText(flow.n8nVersion)}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          className="w-full sm:w-fit"
          disabled={download.isPending}
          aria-describedby="export-helper"
          onClick={() => download.mutate()}
        >
          <DownloadIcon aria-hidden="true" />
          {download.isPending ? FLOW_COPY.downloadPending : FLOW_COPY.download}
        </Button>
        {download.isError ? (
          <p role="alert" data-notice="download-error" className="text-sm text-primary">
            {downloadErrorText(errorCode)}
          </p>
        ) : null}
        <p id="export-helper" className="text-xs text-muted-foreground">
          {FLOW_COPY.exportHelper}
        </p>
      </div>
    </section>
  );
}
