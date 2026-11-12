import type { ReactNode } from "react";

import { AppShell } from "@/features/shell/app-shell";

// Auth is enforced by src/proxy.ts (backend): unauthenticated users never reach this layout.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
