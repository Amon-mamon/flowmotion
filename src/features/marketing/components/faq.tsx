import { ChevronDownIcon } from "lucide-react";

import { FAQ } from "@/features/marketing/copy";
import { containerClass, sectionClass, SectionIntro } from "@/features/marketing/components/primitives";
import { cn } from "@/lib/utils";

/** FAQ (design.md item 8): native details/summary rows, two columns from 1024 px. */
export function Faq() {
  const half = Math.ceil(FAQ.items.length / 2);
  const columns = [FAQ.items.slice(0, half), FAQ.items.slice(half)];
  return (
    <section id="faq" aria-labelledby="faq-heading" className={sectionClass}>
      <div className={containerClass}>
        <SectionIntro id="faq" eyebrow={FAQ.eyebrow} heading={FAQ.heading} />
        <div className="mt-16 grid lg:grid-cols-2 lg:gap-x-16">
          {columns.map((items, column) => (
            <div key={column} className={cn("flex flex-col border-t border-border", column === 1 && "border-t-0 lg:border-t")}>
              {items.map(({ q, a }) => (
                <details key={q} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-5 text-base leading-6 font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDownIcon
                      aria-hidden="true"
                      strokeWidth={1.5}
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <p className="max-w-[65ch] pb-6 text-base leading-[26px] text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
