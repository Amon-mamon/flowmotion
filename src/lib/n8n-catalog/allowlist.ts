/**
 * Allowed n8n node types (docs/node-catalog.md, Tier 1 and Tier 2 tables).
 * Phase 2 uses this list to filter analysis drafts; from Phase 3 the catalog
 * generator checks it against the generated catalog and the build fails when
 * they disagree. Runtime-neutral.
 */

export const NODE_TYPE_PREFIX = "n8n-nodes-base.";

/** Tier 1: core nodes (no credentials, simulated fully). */
export const TIER1_NODE_NAMES = [
  "manualTrigger",
  "webhook",
  "scheduleTrigger",
  "respondToWebhook",
  "if",
  "switch",
  "filter",
  "set",
  "merge",
  "splitInBatches",
  "splitOut",
  "aggregate",
  "sort",
  "limit",
  "removeDuplicates",
  "renameKeys",
  "dateTime",
  "wait",
  "noOp",
  "stopAndError",
] as const;

/** Tier 2: action nodes (need credentials, stubbed in simulation). */
export const TIER2_NODE_NAMES = [
  "httpRequest",
  "emailSend",
  "slack",
  "discord",
  "telegram",
  "gmail",
  "googleSheets",
  "notion",
  "airtable",
  "github",
  "postgres",
  "supabase",
] as const;

export const ALLOWED_NODE_TYPES = [
  ...TIER1_NODE_NAMES.map((name) => `${NODE_TYPE_PREFIX}${name}` as const),
  ...TIER2_NODE_NAMES.map((name) => `${NODE_TYPE_PREFIX}${name}` as const),
] as const;

export type AllowedNodeType =
  | `${typeof NODE_TYPE_PREFIX}${(typeof TIER1_NODE_NAMES)[number]}`
  | `${typeof NODE_TYPE_PREFIX}${(typeof TIER2_NODE_NAMES)[number]}`;

const ALLOWED_SET: ReadonlySet<string> = new Set<string>(ALLOWED_NODE_TYPES);

export function isAllowedNodeType(value: string): value is AllowedNodeType {
  return ALLOWED_SET.has(value);
}

/** Catalog credential names (contract section 7). */
export const CREDENTIAL_NAMES = [
  "SMTP",
  "Slack",
  "Discord",
  "Telegram",
  "Google",
  "Notion",
  "Airtable",
  "GitHub",
  "Postgres",
  "Supabase",
] as const;
export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

const CREDENTIAL_SET: ReadonlySet<string> = new Set<string>(CREDENTIAL_NAMES);

export function isCredentialName(value: string): value is CredentialName {
  return CREDENTIAL_SET.has(value);
}
