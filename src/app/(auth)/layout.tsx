import type { ReactNode } from "react";

import { Wordmark } from "@/components/shared/wordmark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Wordmark />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">{children}</div>
    </main>
  );
}
