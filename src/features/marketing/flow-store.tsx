"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Which section nodes the flow line has reached (design.md "Landing motion
 * identity" items 2 and 4). The flow layer writes it; section intros read it
 * to settle in when their node lights. A tiny external store, not Zustand
 * (Zustand is kept for canvas and editor state).
 */
export type FlowStore = {
  isLit: (id: string) => boolean;
  setLit: (lit: Readonly<Record<string, boolean>>) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createFlowStore(): FlowStore {
  let state: Readonly<Record<string, boolean>> = {};
  const listeners = new Set<() => void>();
  return {
    isLit: (id) => state[id] === true,
    setLit: (lit) => {
      state = { ...lit };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const FlowStoreContext = createContext<FlowStore | null>(null);

export function FlowStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFlowStore);
  return <FlowStoreContext.Provider value={store}>{children}</FlowStoreContext.Provider>;
}

export function useFlowStore(): FlowStore | null {
  return useContext(FlowStoreContext);
}

const noop = () => () => {};

/**
 * True once the flow line has reached this section's node. Without a flow
 * layer (a section rendered on its own) every section counts as reached.
 */
export function useSectionLit(id: string): boolean {
  const store = useFlowStore();
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    () => (store === null ? true : store.isLit(id)),
    () => false,
  );
}
