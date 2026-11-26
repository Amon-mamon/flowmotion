import { PROVIDER_COPY } from "@/features/integrations/copy";
import type { AiProviderId } from "@/features/integrations/types";

/** True when the model id ends with `:free` in any case (design.md free model warning). */
export function isFreeModel(model: string): boolean {
  return model.trim().toLowerCase().endsWith(":free");
}

/**
 * Model value after a provider switch: the new provider's suggestion replaces the field
 * only when it is empty or still holds the previous provider's suggestion; a typed model is kept.
 */
export function modelAfterProviderSwitch(current: string, from: AiProviderId, to: AiProviderId): string {
  const trimmed = current.trim();
  if (trimmed === "" || trimmed === PROVIDER_COPY[from].suggestedModel) {
    return PROVIDER_COPY[to].suggestedModel;
  }
  return current;
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Short relative date such as "3 hours ago" or "yesterday". */
export function formatRelativeDate(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "at an unknown time";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return relativeFormatter.format(Math.round(seconds / 86_400), "day");
  if (abs < 365 * 86_400) return relativeFormatter.format(Math.round(seconds / (30 * 86_400)), "month");
  return relativeFormatter.format(Math.round(seconds / (365 * 86_400)), "year");
}
