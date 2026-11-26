"use client";

import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AiProviderForm } from "@/features/integrations/components/ai-provider-form";
import { FreeModelWarning } from "@/features/integrations/components/free-model-warning";
import { TestResultLine } from "@/features/integrations/components/test-result-line";
import { INTEGRATIONS_COPY, PROVIDER_COPY } from "@/features/integrations/copy";
import { isFreeModel } from "@/features/integrations/model";
import type { AiProviderResponse, AiProviderSetting } from "@/features/integrations/types";

type AiProviderCardBodyProps = {
  response: AiProviderResponse;
  preview: boolean;
};

/**
 * Body of the "AI provider" card: empty state, form, or saved state (design.md
 * "Integrations page"). In the preview, Change and Remove key act on local state only.
 * Re-mount with a new `key` to reset it to another response.
 */
export function AiProviderCardBody({ response, preview }: AiProviderCardBodyProps) {
  const [setting, setSetting] = useState<AiProviderSetting | null>(response.setting);
  const [formOpen, setFormOpen] = useState(false);

  if (formOpen) {
    return (
      <AiProviderForm
        initial={
          setting
            ? { provider: setting.provider, model: setting.model }
            : { provider: "openrouter", model: PROVIDER_COPY.openrouter.suggestedModel }
        }
        savedProvider={setting?.provider ?? null}
        preview={preview}
        onCancel={() => setFormOpen(false)}
      />
    );
  }

  if (!setting) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-sm">{INTEGRATIONS_COPY.emptyText}</p>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {INTEGRATIONS_COPY.addKey}
        </Button>
      </div>
    );
  }

  return (
    <SavedSetting
      setting={setting}
      preview={preview}
      onChange={() => setFormOpen(true)}
      onRemoved={() => setSetting(null)}
    />
  );
}

function SavedSetting({
  setting,
  preview,
  onChange,
  onRemoved,
}: {
  setting: AiProviderSetting;
  preview: boolean;
  onChange: () => void;
  onRemoved: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const comingSoonId = useId();

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">{INTEGRATIONS_COPY.rowProvider}</dt>
        <dd>{PROVIDER_COPY[setting.provider].name}</dd>

        <dt className="text-muted-foreground">{INTEGRATIONS_COPY.rowModel}</dt>
        <dd className="flex min-w-0 flex-col gap-2">
          <span className="font-mono break-all">{setting.model}</span>
          {isFreeModel(setting.model) ? <FreeModelWarning /> : null}
        </dd>

        <dt className="text-muted-foreground">{INTEGRATIONS_COPY.rowApiKey}</dt>
        <dd className="font-mono">{setting.keyHint}</dd>

        <dt className="text-muted-foreground">{INTEGRATIONS_COPY.rowLastTest}</dt>
        <dd>
          {setting.lastTest ? (
            <TestResultLine result={setting.lastTest.result} testedAt={setting.lastTest.testedAt} />
          ) : (
            INTEGRATIONS_COPY.notTested
          )}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={preview}
          aria-describedby={preview ? comingSoonId : undefined}
        >
          {INTEGRATIONS_COPY.testConnection}
        </Button>
        {preview ? (
          <span id={comingSoonId} className="text-sm text-muted-foreground">
            {INTEGRATIONS_COPY.comingSoon}
          </span>
        ) : null}
        <Button type="button" variant="outline" onClick={onChange}>
          {INTEGRATIONS_COPY.change}
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button type="button" variant="link" className="px-0 text-primary" onClick={() => setConfirmOpen(true)}>
            {INTEGRATIONS_COPY.removeKey}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{INTEGRATIONS_COPY.removeTitle}</AlertDialogTitle>
              <AlertDialogDescription>{INTEGRATIONS_COPY.removeBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{INTEGRATIONS_COPY.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  // Preview: local state only (D-54). The full Phase 2e sends DELETE here.
                  setConfirmOpen(false);
                  onRemoved();
                }}
              >
                {INTEGRATIONS_COPY.removeKey}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
