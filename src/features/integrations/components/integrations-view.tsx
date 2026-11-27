"use client";

import { InfoIcon } from "lucide-react";
import { useId, useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AiProviderCardBody } from "@/features/integrations/components/ai-provider-card";
import { INTEGRATIONS_COPY } from "@/features/integrations/copy";
import { PREVIEW_STATE_IDS, PREVIEW_STATES, type PreviewStateId } from "@/features/integrations/fixtures";
import { isAiProviderApiReady } from "@/features/integrations/readiness";
import type { AiProviderResponse } from "@/features/integrations/types";

function isPreviewStateId(value: string): value is PreviewStateId {
  return (PREVIEW_STATE_IDS as readonly string[]).includes(value);
}

const TESTED_AT_OFFSET_MS = 5 * 60_000;

/**
 * Copy of a preview response whose test time is 5 minutes ago (R2eu-4), so the
 * "Tested …" line stays fresh. The shared fixtures are never mutated; the static
 * dates stay for the schema test.
 */
function withFreshTestTime(response: AiProviderResponse): AiProviderResponse {
  const setting = response.setting;
  if (!setting?.lastTest) return response;
  return {
    setting: {
      ...setting,
      lastTest: { ...setting.lastTest, testedAt: new Date(Date.now() - TESTED_AT_OFFSET_MS).toISOString() },
    },
  };
}

/**
 * Integrations page (design.md "Integrations page"; contract Phase 2e-ui, D-54).
 * While `isAiProviderApiReady()` is false the card runs on fixtures chosen with the
 * "Preview state" select; nothing is fetched, stored, or sent.
 */
export function IntegrationsView() {
  const preview = !isAiProviderApiReady();
  const [stateId, setStateId] = useState<PreviewStateId>("empty");
  const headingId = useId();
  const selectId = useId();

  return (
    <>
      <PageHeader title={INTEGRATIONS_COPY.pageTitle} description={INTEGRATIONS_COPY.pageDescription} />

      <Card aria-labelledby={headingId} role="region" className="w-full max-w-[640px] gap-5 py-6">
        <CardHeader className="px-6">
          <h2 id={headingId} className="text-lg font-semibold">
            {INTEGRATIONS_COPY.cardTitle}
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 px-6">
          {preview ? (
            <div
              role="note"
              aria-label={INTEGRATIONS_COPY.previewTitle}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 px-3 py-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">{INTEGRATIONS_COPY.previewTitle}</p>
                  <p className="text-muted-foreground">{INTEGRATIONS_COPY.previewBody}</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pl-6 sm:flex-row sm:items-center sm:gap-3">
                <Label htmlFor={selectId} className="text-xs">
                  {INTEGRATIONS_COPY.previewStateLabel}
                </Label>
                <select
                  id={selectId}
                  value={stateId}
                  onChange={(event) => {
                    if (isPreviewStateId(event.target.value)) setStateId(event.target.value);
                  }}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-60"
                >
                  {PREVIEW_STATE_IDS.map((id) => (
                    <option key={id} value={id} className="bg-popover text-foreground">
                      {PREVIEW_STATES[id].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">{INTEGRATIONS_COPY.explanation}</p>

          <AiProviderCardBody
            key={stateId}
            response={withFreshTestTime(PREVIEW_STATES[stateId].response)}
            preview={preview}
          />
        </CardContent>
      </Card>
    </>
  );
}
