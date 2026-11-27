import { vi } from "vitest";

/**
 * Test-only controllable `matchMedia` for the landing page tests. Each query
 * matches according to `state`; `setMedia` updates the state and notifies
 * the matching `change` listeners, like a real MediaQueryList.
 */

export type MediaState = { reduced: boolean; finePointer: boolean; desktop: boolean; wide: boolean };

const listeners = new Map<string, Set<() => void>>();
let state: MediaState = { reduced: false, finePointer: false, desktop: false, wide: false };

function matches(query: string): boolean {
  if (query.includes("prefers-reduced-motion")) return state.reduced;
  if (query.includes("pointer: fine")) return state.finePointer;
  if (query.includes("min-width: 768px")) return state.desktop;
  if (query.includes("min-width: 1280px")) return state.wide;
  return false;
}

export function installMatchMedia(initial: Partial<MediaState> = {}) {
  state = { reduced: false, finePointer: false, desktop: false, wide: false, ...initial };
  listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return matches(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        const set = listeners.get(query) ?? new Set();
        set.add(listener);
        listeners.set(query, set);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.get(query)?.delete(listener);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

export function setMedia(next: Partial<MediaState>) {
  state = { ...state, ...next };
  for (const set of listeners.values()) for (const listener of [...set]) listener();
}
