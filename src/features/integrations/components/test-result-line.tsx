import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import { TEST_RESULT_COPY, testedLine } from "@/features/integrations/copy";
import { formatRelativeDate } from "@/features/integrations/model";
import type { AiTestResult } from "@/features/integrations/types";

/** Outlined test result line: icon, title, sentence, muted "Tested <relative date>". */
export function TestResultLine({ result, testedAt }: { result: AiTestResult; testedAt: string }) {
  const copy = TEST_RESULT_COPY[result];
  const Icon = result === "working" ? CircleCheckIcon : CircleAlertIcon;
  return (
    <div
      data-testid="test-result"
      className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm"
    >
      <Icon
        aria-hidden="true"
        className={result === "working" ? "mt-0.5 size-4 shrink-0 text-foreground" : "mt-0.5 size-4 shrink-0 text-primary"}
      />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{copy.title}</p>
        <p>{copy.sentence}</p>
        <p className="text-muted-foreground">{testedLine(formatRelativeDate(testedAt))}</p>
      </div>
    </div>
  );
}
