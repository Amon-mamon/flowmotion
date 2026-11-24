import {
  ArrowUpDownIcon,
  CalendarClockIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon,
  CopyMinusIcon,
  DatabaseIcon,
  FileTextIcon,
  FilterIcon,
  GitBranchIcon,
  GlobeIcon,
  HandIcon,
  LayersIcon,
  ListIcon,
  MailIcon,
  MergeIcon,
  MessageSquareIcon,
  OctagonXIcon,
  PencilLineIcon,
  RepeatIcon,
  ReplyIcon,
  SendIcon,
  SplitIcon,
  TableIcon,
  TextCursorInputIcon,
  TimerIcon,
  WebhookIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

import { shortNodeType } from "@/features/flows/graph";

/** Icon per allowed node type (docs/node-catalog.md); anything else gets the generic icon. */
const NODE_ICON: Readonly<Record<string, LucideIcon>> = {
  manualTrigger: HandIcon,
  webhook: WebhookIcon,
  scheduleTrigger: CalendarClockIcon,
  respondToWebhook: ReplyIcon,
  if: GitBranchIcon,
  switch: SplitIcon,
  filter: FilterIcon,
  set: PencilLineIcon,
  merge: MergeIcon,
  splitInBatches: RepeatIcon,
  splitOut: ListIcon,
  aggregate: LayersIcon,
  sort: ArrowUpDownIcon,
  limit: ListIcon,
  removeDuplicates: CopyMinusIcon,
  renameKeys: TextCursorInputIcon,
  dateTime: ClockIcon,
  wait: TimerIcon,
  noOp: CircleIcon,
  stopAndError: OctagonXIcon,
  httpRequest: GlobeIcon,
  emailSend: MailIcon,
  slack: MessageSquareIcon,
  discord: MessageSquareIcon,
  telegram: SendIcon,
  gmail: MailIcon,
  googleSheets: TableIcon,
  notion: FileTextIcon,
  airtable: TableIcon,
  github: CircleDotIcon,
  postgres: DatabaseIcon,
  supabase: DatabaseIcon,
};

/** Decorative icon for a node type; the type name is always shown as text next to it. */
export function NodeIcon({ nodeType, className }: { nodeType: string; className?: string }) {
  const short = shortNodeType(nodeType);
  const Icon = Object.hasOwn(NODE_ICON, short) ? NODE_ICON[short]! : WorkflowIcon;
  return <Icon aria-hidden="true" className={className} />;
}
