/**
 * The validator's own parameter table (D-50, S3a-3, R3a-5; docs/security.md
 * section 9, docs/testing.md rules 5 and 8). Written by hand, independently
 * of the node profiles, and never imports them: it is the second check, so a
 * later profile change or any code path that writes n8n JSON without the
 * compiler still cannot ship raw SQL, deletes, literal recipients, a proxy, or
 * code. Tests only check that every golden passes and that the table never
 * holds a forbidden operation or parameter name. Pure and runtime-neutral.
 */

type Scalar = string | number | boolean;

export interface AllowedNodeParams {
  /** Every top-level parameter name the node may carry. */
  readonly names: readonly string[];
  /** Mode-selecting parameters and the only values they may hold (when present). */
  readonly modes: Readonly<Record<string, readonly Scalar[]>>;
  /** Object-valued option containers (`options`, …) and the only keys allowed inside. */
  readonly containers: Readonly<Record<string, readonly string[]>>;
  /** Destination parameters: present, and exactly one `YOUR_…` token (a resource locator's `value`). */
  readonly destinations: readonly string[];
  /**
   * Modes the profile emits only on some paths. Every other key of `modes`
   * is required (R3aR-2, S3aR-3): fail closed, never n8n's default.
   */
  readonly optionalModes: readonly string[];
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const entry = (
  names: readonly string[],
  modes: Record<string, readonly Scalar[]> = {},
  containers: Record<string, readonly string[]> = {},
  destinations: readonly string[] = [],
  optionalModes: readonly string[] = [],
): AllowedNodeParams => ({ names, modes, containers, destinations, optionalModes });

const P = "n8n-nodes-base.";

export const ALLOWED_PARAMS: Readonly<Record<string, AllowedNodeParams>> = {
  // --- tier 1 ---
  [`${P}manualTrigger`]: entry([]),
  [`${P}webhook`]: entry(
    ["httpMethod", "path", "responseMode", "options"],
    { httpMethod: HTTP_METHODS, responseMode: ["onReceived", "responseNode"] },
    { options: [] },
  ),
  [`${P}scheduleTrigger`]: entry(["rule"]),
  [`${P}respondToWebhook`]: entry(
    ["respondWith", "responseBody", "options"],
    { respondWith: ["json"] },
    { options: ["responseCode"] },
  ),
  [`${P}if`]: entry(["conditions", "looseTypeValidation", "options"], {}, { options: [] }),
  [`${P}filter`]: entry(["conditions", "looseTypeValidation", "options"], {}, { options: [] }),
  [`${P}switch`]: entry(
    ["mode", "rules", "looseTypeValidation", "options"],
    { mode: ["rules"] },
    { options: ["fallbackOutput"] },
  ),
  [`${P}set`]: entry(
    ["mode", "assignments", "includeOtherFields", "options"],
    { mode: ["manual"] },
    { options: [] },
  ),
  [`${P}merge`]: entry(["mode", "numberInputs"], { mode: ["append"] }),
  [`${P}splitInBatches`]: entry(["batchSize", "options"], {}, { options: [] }),
  [`${P}splitOut`]: entry(
    ["fieldToSplitOut", "include", "options"],
    { include: ["noOtherFields"] },
    { options: [] },
  ),
  [`${P}aggregate`]: entry(
    ["aggregate", "destinationFieldName", "include", "options"],
    { aggregate: ["aggregateAllItemData"], include: ["allFields"] },
    { options: [] },
  ),
  [`${P}sort`]: entry(["type", "sortFieldsUi", "options"], { type: ["simple"] }, { options: [] }),
  [`${P}limit`]: entry(["maxItems", "keep"], { keep: ["firstItems", "lastItems"] }),
  [`${P}removeDuplicates`]: entry(
    ["operation", "compare", "fieldsToCompare", "options"],
    // In-memory deduplication of the current items; not a data operation.
    { operation: ["removeDuplicateInputItems"], compare: ["allFields", "selectedFields"] },
    { options: [] },
  ),
  [`${P}renameKeys`]: entry(["keys"]),
  [`${P}dateTime`]: entry(
    ["operation", "includeTime", "date", "format", "customFormat", "outputFieldName", "options"],
    { operation: ["getCurrentDate", "formatDate"], format: ["yyyy-MM-dd", "custom"] },
    { options: [] },
    [],
    ["format"],
  ),
  [`${P}wait`]: entry(["resume", "amount", "unit"], { resume: ["timeInterval"], unit: ["seconds"] }),
  [`${P}noOp`]: entry([]),
  [`${P}stopAndError`]: entry(["errorType", "errorMessage"], { errorType: ["errorMessage"] }),
  // --- tier 2 ---
  [`${P}httpRequest`]: entry(
    [
      "method",
      "url",
      "authentication",
      "sendQuery",
      "specifyQuery",
      "queryParameters",
      "sendHeaders",
      "specifyHeaders",
      "headerParameters",
      "sendBody",
      "contentType",
      "specifyBody",
      "bodyParameters",
      "options",
    ],
    {
      method: HTTP_METHODS,
      authentication: ["none"],
      sendQuery: [true],
      specifyQuery: ["keypair"],
      sendHeaders: [true],
      specifyHeaders: ["keypair"],
      sendBody: [true],
      contentType: ["json"],
      specifyBody: ["keypair"],
    },
    { options: [] },
    [],
    ["sendQuery", "specifyQuery", "sendHeaders", "specifyHeaders", "sendBody", "contentType", "specifyBody"],
  ),
  [`${P}emailSend`]: entry(
    ["operation", "fromEmail", "toEmail", "subject", "emailFormat", "text", "options"],
    { operation: ["send"], emailFormat: ["text"] },
    { options: [] },
    ["fromEmail", "toEmail"],
  ),
  [`${P}slack`]: entry(
    ["resource", "operation", "select", "channelId", "messageType", "text", "otherOptions"],
    { resource: ["message"], operation: ["post"], select: ["channel"], messageType: ["text"] },
    { otherOptions: [] },
    ["channelId"],
  ),
  [`${P}discord`]: entry(
    ["authentication", "operation", "content", "options"],
    { authentication: ["webhook"], operation: ["sendLegacy"] },
    { options: [] },
  ),
  [`${P}telegram`]: entry(
    ["resource", "operation", "chatId", "text", "additionalFields"],
    { resource: ["message"], operation: ["sendMessage"] },
    { additionalFields: [] },
    ["chatId"],
  ),
  [`${P}gmail`]: entry(
    ["resource", "operation", "sendTo", "subject", "emailType", "message", "options"],
    { resource: ["message"], operation: ["send"], emailType: ["text"] },
    { options: [] },
    ["sendTo"],
  ),
  [`${P}googleSheets`]: entry(
    ["resource", "operation", "documentId", "sheetName", "columns", "options"],
    { resource: ["sheet"], operation: ["append", "read"] },
    { options: [] },
    ["documentId", "sheetName"],
  ),
  [`${P}notion`]: entry(
    ["resource", "operation", "dataSourceId", "title", "options"],
    { resource: ["databasePage"], operation: ["create"] },
    { options: [] },
    ["dataSourceId"],
  ),
  [`${P}airtable`]: entry(
    ["resource", "operation", "base", "table", "columns", "options"],
    { resource: ["record"], operation: ["create"] },
    { options: [] },
    ["base", "table"],
  ),
  [`${P}github`]: entry(
    ["resource", "operation", "owner", "repository", "title", "body", "labels", "assignees"],
    { resource: ["issue"], operation: ["create"] },
    {},
    ["owner", "repository"],
  ),
  [`${P}postgres`]: entry(
    ["operation", "schema", "table", "columns", "returnAll", "limit", "options"],
    { operation: ["insert", "select"], returnAll: [false] },
    { options: [] },
    [],
    ["returnAll"],
  ),
  [`${P}supabase`]: entry(
    ["resource", "operation", "tableId", "dataToSend", "fieldsUi", "returnAll", "limit", "filterType"],
    {
      resource: ["row"],
      operation: ["create", "getAll"],
      dataToSend: ["defineBelow"],
      returnAll: [false],
      filterType: ["none"],
    },
    {},
    [],
    ["dataToSend", "returnAll", "filterType"],
  ),
};

/** The modes a node must carry. */
export function requiredModes(table: AllowedNodeParams): string[] {
  return Object.keys(table.modes).filter((name) => !table.optionalModes.includes(name));
}

export function allowedParams(type: string): AllowedNodeParams | undefined {
  return Object.hasOwn(ALLOWED_PARAMS, type) ? ALLOWED_PARAMS[type] : undefined;
}

/** A destination value: exactly one placeholder token. */
export const DESTINATION_TOKEN = /^YOUR_[A-Z0-9_]{2,40}$/;

/** `FieldName` (header names have no `-` in v1, OQ-28). */
const HEADER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_HEADER_EXACT: ReadonlySet<string> = new Set([
  "host",
  "forwarded",
  "te",
  "connection",
  "upgrade",
  "expect",
]);
const FORBIDDEN_HEADER_PART = /auth|token|secret|key|cookie|session|password|passwd|signature/;
/** S3aR-4: routing and framing headers, matched after `_` is read as `-` (CGI-style back ends treat them alike). */
const FORBIDDEN_HEADER_PREFIX: readonly string[] = [
  "x-forwarded",
  "x-real-ip",
  "x-original",
  "x-rewrite",
  "x-http-method",
  "x-method-override",
  "transfer-encoding",
  "content-length",
  "proxy-",
];

/** Validator header rule (D-51, S3aR-4): written independently of the httpRequest profile. */
export function isAllowedHeaderName(name: string): boolean {
  if (!HEADER_NAME.test(name)) return false;
  const lower = name.toLowerCase();
  if (FORBIDDEN_HEADER_EXACT.has(lower) || FORBIDDEN_HEADER_PART.test(lower)) return false;
  const normalized = lower.replace(/_/g, "-");
  if (FORBIDDEN_HEADER_EXACT.has(normalized)) return false;
  return !FORBIDDEN_HEADER_PREFIX.some((prefix) => normalized.startsWith(prefix));
}
