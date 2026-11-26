import type { ReactNode } from "react";

import { FEATURES } from "@/features/marketing/copy";
import {
  ComingSoonTag,
  containerClass,
  sectionClass,
  SectionIntro,
} from "@/features/marketing/components/primitives";
import { Reveal } from "@/features/marketing/components/reveal";
import { NodeGraphPreview } from "@/features/marketing/previews/node-graph-preview";
import {
  FindingRowPreview,
  JsonSnippetPreview,
  RecommendationCardPreview,
} from "@/features/marketing/previews/parts";
import { PreviewRoot } from "@/features/marketing/previews/preview-root";
import { PREVIEW_RECOMMENDATIONS } from "@/features/marketing/preview-data";
import { isFlowGenerationLive } from "@/features/marketing/readiness";
import { cn } from "@/lib/utils";

type FeatureCopy = { title: string; body: string; comingSoon: boolean };

function FeatureCard({
  copy,
  visual,
  previewName,
  className,
  layout = "stack",
  delay,
}: {
  copy: FeatureCopy;
  visual: ReactNode;
  previewName: string;
  className?: string;
  layout?: "stack" | "split";
  delay?: number;
}) {
  const live = isFlowGenerationLive();
  return (
    <Reveal className={cn("h-full", className)} delay={delay}>
      <article
        className={cn(
          "flex h-full flex-col gap-8 overflow-hidden rounded-xl border border-border bg-card p-6 transition-colors hover:border-border-hover md:p-8",
          layout === "split" && "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-12",
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl leading-7 font-semibold text-foreground">{copy.title}</h3>
            {copy.comingSoon && !live ? <ComingSoonTag /> : null}
          </div>
          <p className="max-w-[65ch] text-base leading-[26px] text-muted-foreground">{copy.body}</p>
        </div>
        <PreviewRoot name={previewName} className={cn(layout === "stack" && "mt-auto flex flex-1 flex-col justify-end")}>
          {visual}
        </PreviewRoot>
      </article>
    </Reveal>
  );
}

/**
 * Features (design.md item 5): uneven bento. One large card spanning two
 * rows, two smaller cards beside it, and one wide card underneath.
 */
export function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className={sectionClass}>
      <div className={containerClass}>
        <SectionIntro id="features" eyebrow={FEATURES.eyebrow} heading={FEATURES.heading} lead={FEATURES.lead} />
        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:grid-rows-[auto_auto]">
          <FeatureCard
            copy={FEATURES.graphs}
            previewName="feature-graph"
            className="md:col-span-2 lg:col-span-7 lg:row-span-2"
            visual={
              <div className="flex flex-1 items-center rounded-xl border border-border bg-background px-4 py-10 sm:px-8">
                <NodeGraphPreview edges="static" />
              </div>
            }
          />
          <FeatureCard
            copy={FEATURES.findings}
            previewName="feature-finding"
            className="lg:col-span-5"
            delay={0.08}
            visual={<FindingRowPreview />}
          />
          <FeatureCard
            copy={FEATURES.recommendations}
            previewName="feature-recommendation"
            className="lg:col-span-5"
            delay={0.16}
            visual={<RecommendationCardPreview recommendation={PREVIEW_RECOMMENDATIONS[0]!} />}
          />
          <FeatureCard
            copy={FEATURES.export}
            previewName="feature-export"
            className="md:col-span-2 lg:col-span-12"
            layout="split"
            visual={<JsonSnippetPreview />}
          />
        </div>
      </div>
    </section>
  );
}
