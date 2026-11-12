"use client";

import { MenuIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Wordmark } from "@/components/shared/wordmark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "@/features/shell/sidebar";

/** App shell: fixed sidebar on large screens, sheet on small screens. */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
      >
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:hidden">
          <Wordmark href="/dashboard" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
              <MenuIcon aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Dashboard, settings, and sign out</SheetDescription>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 outline-none sm:px-8">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
