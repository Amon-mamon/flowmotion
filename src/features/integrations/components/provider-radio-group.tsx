"use client";

import { useRef, type KeyboardEvent } from "react";

import { PROVIDER_COPY } from "@/features/integrations/copy";
import { aiProviderIdSchema, type AiProviderId } from "@/features/integrations/types";
import { cn } from "@/lib/utils";

const PROVIDERS = aiProviderIdSchema.options;

type ProviderRadioGroupProps = {
  labelId: string;
  value: AiProviderId;
  onChange: (next: AiProviderId) => void;
};

/**
 * Segmented provider picker with radio semantics (design.md "Integrations page"):
 * one tab stop, arrow keys move and select, Home/End jump to the ends.
 */
export function ProviderRadioGroup({ labelId, value, onChange }: ProviderRadioGroupProps) {
  const refs = useRef<Record<AiProviderId, HTMLButtonElement | null>>({ openrouter: null, anthropic: null });

  function move(delta: number | "first" | "last") {
    const index = PROVIDERS.indexOf(value);
    const nextIndex =
      delta === "first"
        ? 0
        : delta === "last"
          ? PROVIDERS.length - 1
          : (index + delta + PROVIDERS.length) % PROVIDERS.length;
    const next = PROVIDERS[nextIndex];
    if (!next) return;
    onChange(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        move("first");
        break;
      case "End":
        event.preventDefault();
        move("last");
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="inline-flex w-full rounded-lg border border-border bg-surface-2 p-1 sm:w-auto"
    >
      {PROVIDERS.map((provider) => {
        const checked = provider === value;
        return (
          <button
            key={provider}
            ref={(node) => {
              refs.current[provider] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(provider)}
            onKeyDown={onKeyDown}
            className={cn(
              "h-8 flex-1 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none",
              checked && "bg-primary text-primary-foreground hover:text-primary-foreground",
            )}
          >
            {PROVIDER_COPY[provider].name}
          </button>
        );
      })}
    </div>
  );
}
