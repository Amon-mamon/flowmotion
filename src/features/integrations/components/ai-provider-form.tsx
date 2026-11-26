"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INTEGRATIONS_COPY, PROVIDER_COPY, modelHint } from "@/features/integrations/copy";
import { FreeModelWarning } from "@/features/integrations/components/free-model-warning";
import { ProviderRadioGroup } from "@/features/integrations/components/provider-radio-group";
import { isFreeModel, modelAfterProviderSwitch } from "@/features/integrations/model";
import {
  aiProviderFormSchema,
  type AiProviderFormValues,
  type AiProviderId,
} from "@/features/integrations/types";

type AiProviderFormProps = {
  initial: AiProviderFormValues;
  /** Provider of the saved setting being changed; null for a new key. */
  savedProvider: AiProviderId | null;
  /** Preview mode (D-54): Save key is disabled with "Coming soon". */
  preview: boolean;
  onCancel: () => void;
};

/**
 * Add or change the AI provider setting (design.md "Integrations page", form).
 *
 * Key handling (contract Phase 2e-ui item 4, D-54): the API key input is a plain
 * uncontrolled password input. It is not registered with react-hook-form, has no
 * change handler and no `name`, and no code ever reads its value. Submitting, pressing
 * Enter in a field, switching provider, and every button only write `""` into it.
 */
export function AiProviderForm({ initial, savedProvider, preview, onCancel }: AiProviderFormProps) {
  const ids = {
    provider: useId(),
    key: useId(),
    keyHelper: useId(),
    model: useId(),
    modelHint: useId(),
    modelError: useId(),
    freeWarning: useId(),
    comingSoon: useId(),
  };
  const keyInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    setValue,
    getValues,
    control,
    formState: { errors },
  } = useForm<AiProviderFormValues>({
    resolver: zodResolver(aiProviderFormSchema),
    defaultValues: initial,
    mode: "onTouched",
  });

  const provider = useWatch({ control, name: "provider" });
  const model = useWatch({ control, name: "model" });
  const providerCopy = PROVIDER_COPY[provider];
  const keyHelper =
    savedProvider !== null && savedProvider === provider
      ? INTEGRATIONS_COPY.keyHelperKeep
      : INTEGRATIONS_COPY.keyHelperNew;
  const showFreeWarning = isFreeModel(model);
  const modelError = errors.model?.message;

  // R2eu-1: empty the key field before the form leaves the page (preview state change,
  // Cancel, navigation), so no browser password manager offers to save a typed key.
  // Layout-effect cleanups run before React removes the form's DOM nodes.
  useLayoutEffect(() => {
    const node = keyInputRef.current;
    return () => {
      if (node) node.value = "";
    };
  }, []);

  /** Writes "" into the key input. Never reads it. */
  function clearKey() {
    if (keyInputRef.current) keyInputRef.current.value = "";
  }

  function switchProvider(next: AiProviderId) {
    const current = getValues("provider");
    if (next === current) return;
    setValue("model", modelAfterProviderSwitch(getValues("model"), current, next), { shouldValidate: true });
    setValue("provider", next);
    clearKey();
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      clearKey();
    }
  }

  const modelDescribedBy = [modelError ? ids.modelError : ids.modelHint, showFreeWarning ? ids.freeWarning : null]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      noValidate
      aria-label="AI provider key"
      onKeyDown={onFormKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        clearKey();
        // The save request arrives in the full Phase 2e. In the preview nothing is saved or sent.
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <span id={ids.provider} className="text-sm font-medium">
          {INTEGRATIONS_COPY.providerLabel}
        </span>
        <ProviderRadioGroup labelId={ids.provider} value={provider} onChange={switchProvider} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.key}>{providerCopy.keyLabel}</Label>
        <input
          ref={keyInputRef}
          id={ids.key}
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          placeholder={providerCopy.keyPlaceholder}
          aria-describedby={ids.keyHelper}
          className="h-8 w-full min-w-0 rounded-lg border border-input bg-surface-2 px-2.5 py-1 font-mono text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <p id={ids.keyHelper} className="text-xs text-muted-foreground">
          {keyHelper}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.model}>{INTEGRATIONS_COPY.modelLabel}</Label>
        <Input
          id={ids.model}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="font-mono"
          aria-invalid={modelError ? true : undefined}
          aria-describedby={modelDescribedBy}
          {...register("model")}
        />
        {modelError ? (
          <p id={ids.modelError} role="alert" className="text-xs text-primary">
            {modelError}
          </p>
        ) : (
          <p id={ids.modelHint} className="text-xs text-muted-foreground">
            {modelHint(providerCopy.suggestedModel)}
          </p>
        )}
        {showFreeWarning ? <FreeModelWarning id={ids.freeWarning} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={preview} aria-describedby={preview ? ids.comingSoon : undefined}>
          {INTEGRATIONS_COPY.saveKey}
        </Button>
        {preview ? (
          <span id={ids.comingSoon} className="text-sm text-muted-foreground">
            {INTEGRATIONS_COPY.comingSoon}
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            clearKey();
            onCancel();
          }}
        >
          {INTEGRATIONS_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
