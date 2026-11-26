import { FACTS } from "@/features/marketing/copy";
import { ComingSoonTag, containerClass } from "@/features/marketing/components/primitives";
import { isFlowGenerationLive } from "@/features/marketing/readiness";

/** Four true facts in mono labels, separated by hairlines; 2 × 2 under 768 px. */
export function FactStrip() {
  const live = isFlowGenerationLive();
  return (
    <div className="border-y border-grid">
      <ul className={`${containerClass} grid grid-cols-2 md:grid-cols-4`}>
        {FACTS.map((fact, index) => (
          <li
            key={fact.label}
            className={[
              "flex min-h-20 flex-wrap items-center gap-x-3 gap-y-2 border-grid py-5 pr-4 md:justify-center md:px-4",
              index % 2 === 1 ? "border-l pl-4" : "",
              index >= 2 ? "border-t md:border-t-0" : "",
              index === 2 ? "md:border-l md:pl-4" : "",
            ].join(" ")}
          >
            <span className="fm-mono-label text-muted-foreground">{fact.label}</span>
            {fact.comingSoon && !live ? <ComingSoonTag /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
