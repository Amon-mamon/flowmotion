import { InfoIcon, OctagonAlertIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { RISK_LABEL } from "@/features/analysis/copy";
import type { Severity } from "@/features/analysis/schemas";

const RISK_ICON: Readonly<Record<Severity, LucideIcon>> = {
  high: OctagonAlertIcon,
  medium: TriangleAlertIcon,
  low: InfoIcon,
};

/** Border and text in the risk token (design.md, D-36); transparent background. */
const RISK_CLASS: Readonly<Record<Severity, string>> = {
  low: "border-risk-low text-risk-low",
  medium: "border-risk-medium text-risk-medium",
  high: "border-risk-high text-risk-high",
};

/**
 * Outlined recommendation risk badge (D-36). Used only on recommendation
 * cards; finding severity keeps the outlined red SeverityBadge.
 */
export function RiskBadge({ risk }: { risk: Severity }) {
  const Icon = RISK_ICON[risk];
  return (
    <Badge variant="outline" data-risk={risk} className={`rounded-lg bg-transparent ${RISK_CLASS[risk]}`}>
      <Icon aria-hidden="true" />
      {RISK_LABEL[risk]}
    </Badge>
  );
}
