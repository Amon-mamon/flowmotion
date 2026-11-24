import { create } from "zustand";

/**
 * Canvas UI state for the flow page (AGENTS.md: Zustand only for canvas and
 * editor state). The flow itself is server data and lives in TanStack Query.
 */
type FlowCanvasState = {
  /** Key of the node whose inspector is open, or null. */
  selectedNodeKey: string | null;
  selectNode: (key: string) => void;
  clearSelection: () => void;
};

export const useFlowCanvasStore = create<FlowCanvasState>((set) => ({
  selectedNodeKey: null,
  selectNode: (key) => set({ selectedNodeKey: key }),
  clearSelection: () => set({ selectedNodeKey: null }),
}));
