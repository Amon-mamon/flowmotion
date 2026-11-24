import type { AllowedNodeType } from "@/lib/n8n-catalog/allowlist";

import { aggregateProfile } from "./aggregate";
import { airtableProfile } from "./airtable";
import { dateTimeProfile } from "./date-time";
import { discordProfile } from "./discord";
import { emailSendProfile } from "./email-send";
import { filterProfile } from "./filter";
import { githubProfile } from "./github";
import { gmailProfile } from "./gmail";
import { googleSheetsProfile } from "./google-sheets";
import { httpRequestProfile } from "./http-request";
import { ifProfile } from "./if";
import { limitProfile } from "./limit";
import { manualTriggerProfile } from "./manual-trigger";
import { mergeProfile } from "./merge";
import { noOpProfile } from "./no-op";
import { notionProfile } from "./notion";
import { postgresProfile } from "./postgres";
import { removeDuplicatesProfile } from "./remove-duplicates";
import { renameKeysProfile } from "./rename-keys";
import { respondToWebhookProfile } from "./respond-to-webhook";
import { scheduleTriggerProfile } from "./schedule-trigger";
import { setProfile } from "./set";
import { slackProfile } from "./slack";
import { sortProfile } from "./sort";
import { splitInBatchesProfile } from "./split-in-batches";
import { splitOutProfile } from "./split-out";
import { stopAndErrorProfile } from "./stop-and-error";
import { supabaseProfile } from "./supabase";
import { switchProfile } from "./switch";
import { telegramProfile } from "./telegram";
import type { NodeProfile } from "./types";
import { waitProfile } from "./wait";
import { webhookProfile } from "./webhook";

/** The profile index, keyed by full type. One entry per allowed node (32). */
export const NODE_PROFILES: Readonly<Record<AllowedNodeType, NodeProfile>> = {
  "n8n-nodes-base.manualTrigger": manualTriggerProfile,
  "n8n-nodes-base.webhook": webhookProfile,
  "n8n-nodes-base.scheduleTrigger": scheduleTriggerProfile,
  "n8n-nodes-base.respondToWebhook": respondToWebhookProfile,
  "n8n-nodes-base.if": ifProfile,
  "n8n-nodes-base.switch": switchProfile,
  "n8n-nodes-base.filter": filterProfile,
  "n8n-nodes-base.set": setProfile,
  "n8n-nodes-base.merge": mergeProfile,
  "n8n-nodes-base.splitInBatches": splitInBatchesProfile,
  "n8n-nodes-base.splitOut": splitOutProfile,
  "n8n-nodes-base.aggregate": aggregateProfile,
  "n8n-nodes-base.sort": sortProfile,
  "n8n-nodes-base.limit": limitProfile,
  "n8n-nodes-base.removeDuplicates": removeDuplicatesProfile,
  "n8n-nodes-base.renameKeys": renameKeysProfile,
  "n8n-nodes-base.dateTime": dateTimeProfile,
  "n8n-nodes-base.wait": waitProfile,
  "n8n-nodes-base.noOp": noOpProfile,
  "n8n-nodes-base.stopAndError": stopAndErrorProfile,
  "n8n-nodes-base.httpRequest": httpRequestProfile,
  "n8n-nodes-base.emailSend": emailSendProfile,
  "n8n-nodes-base.slack": slackProfile,
  "n8n-nodes-base.discord": discordProfile,
  "n8n-nodes-base.telegram": telegramProfile,
  "n8n-nodes-base.gmail": gmailProfile,
  "n8n-nodes-base.googleSheets": googleSheetsProfile,
  "n8n-nodes-base.notion": notionProfile,
  "n8n-nodes-base.airtable": airtableProfile,
  "n8n-nodes-base.github": githubProfile,
  "n8n-nodes-base.postgres": postgresProfile,
  "n8n-nodes-base.supabase": supabaseProfile,
};

export function nodeProfile(type: string): NodeProfile | undefined {
  return Object.hasOwn(NODE_PROFILES, type) ? NODE_PROFILES[type as AllowedNodeType] : undefined;
}

/** The node reference shown to the generation model, one line per node. */
export function buildNodeReference(types?: readonly AllowedNodeType[]): string {
  const list = types ?? (Object.keys(NODE_PROFILES) as AllowedNodeType[]);
  return list.map((type) => NODE_PROFILES[type].promptReference).join("\n");
}

export type { NodeProfile } from "./types";
