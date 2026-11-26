import type { ReactNode } from "react";

import { SiteHeader } from "@/features/marketing/components/site-header";

type LegalPageProps = {
  title: string;
  updated: string;
  children: ReactNode;
};

/**
 * Plain static page layout for /privacy and /terms: same tokens and header,
 * no animation, no smooth scrolling. Header anchors point back to `/#…`.
 */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <>
      <SiteHeader anchorBase="/" />
      <main id="main" className="flex-1">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16 sm:px-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">
              Last updated {updated}
            </p>
          </header>
          <div className="flex flex-col gap-8 text-base leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_section]:flex [&_section]:flex-col [&_section]:gap-3">
            {children}
          </div>
        </article>
      </main>
    </>
  );
}
