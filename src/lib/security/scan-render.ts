import { scan } from "@/lib/security/secret-scanner";
import { isJsonValue, JSON_MAX_DEPTH } from "@/schemas/flow";

/**
 * The shared scan rendering (docs/security.md section 9 "Scan rendering",
 * D-49). The only text the secret scanner reads in FlowSpec rule F9,
 * validator rule 7, and `assertExportSafe`, so the three checks agree.
 * Pure and runtime-neutral.
 *
 * It never rebuilds or merges objects. It walks the value iteratively over
 * own keys in insertion order and writes one line per item:
 *  1. every scalar leaf as `"<name>": <JSON value>` (an array element takes
 *     the nearest property name above it);
 *  2. for every object with a string `name` and a scalar `value`, or a string
 *     `fieldId` and a scalar `fieldValue`, one extra line
 *     `"<name or fieldId>": <JSON value>`, so a pair reads as one assignment;
 *  3. exactly two positional renames (name only, never the value): FlowSpec
 *     `nodes[i].key` is written as `node`, and the n8n renameKeys entries
 *     `nodes[i].parameters.keys.key[j].currentKey` / `.newKey` are written as
 *     `from` / `to`. A property with those names anywhere else keeps its name.
 *  4. (S3aR-5) a respondToWebhook `nodes[i].parameters.responseBody` that is
 *     a JSON text is also parsed and its leaves rendered, so a secret-named
 *     literal inside the reply is seen like any other pair.
 */

/**
 * What the rendering accepts: JSON, plus absent (`undefined`) properties, so
 * a parsed FlowSpec draft with optional fields passes without a cast.
 */
export type ScanInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ScanInput[]
  | { readonly [key: string]: ScanInput };

/** Own keys refused at any depth of an export and in every field name (D-49). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const RENAME_KEYS_TYPE = "n8n-nodes-base.renameKeys";
const RESPOND_TYPE = "n8n-nodes-base.respondToWebhook";
/** Nesting the rendering walks before it refuses, counted from the value passed in. */
export const SCAN_MAX_DEPTH = JSON_MAX_DEPTH;

/** Thrown for input deeper than `SCAN_MAX_DEPTH`; `scanFindsSecret` turns it into a refusal. */
export class ScanRenderError extends Error {
  constructor() {
    super("Value too deep to render for the scanner");
    this.name = "ScanRenderError";
  }
}

/** Where a value sits, as far as the two positional renames care. */
type Position =
  | "root"
  | "nodes"
  | "node"
  | "renameNode"
  | "renameParameters"
  | "renameKeys"
  | "renameKeyList"
  | "renameEntry"
  | "respondNode"
  | "respondParameters"
  | "respondBody"
  | "other";

interface Frame {
  value: ScanInput;
  name: string;
  position: Position;
  depth: number;
}

type Scalar = string | number | boolean | null;
type ScanObject = { readonly [key: string]: ScanInput };

function isScalar(value: ScanInput): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isObject(value: ScanInput): value is ScanObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(object: ScanObject, key: string): ScanInput {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** A respondToWebhook body text parsed as JSON, or undefined when it is not JSON. */
function parsedBody(text: string): ScanInput {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonValue(parsed, SCAN_MAX_DEPTH) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function line(name: string, value: string | number | boolean | null): string {
  return `${JSON.stringify(name)}: ${JSON.stringify(value)}`;
}

/** The name written for property `key` of an object at `position`. */
function renamed(position: Position, key: string): string {
  if ((position === "node" || position === "renameNode" || position === "respondNode") && key === "key") return "node";
  if (position === "renameEntry") {
    if (key === "currentKey") return "from";
    if (key === "newKey") return "to";
  }
  return key;
}

/** The position of the child under property `key` (or an array element) of a value at `position`. */
function childPosition(position: Position, key: string | null, child: ScanInput): Position {
  switch (position) {
    case "root":
      return key === "nodes" ? "nodes" : "other";
    case "nodes":
      if (key !== null || !isObject(child)) return "other";
      if (own(child, "type") === RENAME_KEYS_TYPE) return "renameNode";
      return own(child, "type") === RESPOND_TYPE ? "respondNode" : "node";
    case "respondNode":
      return key === "parameters" ? "respondParameters" : "other";
    case "renameNode":
      return key === "parameters" ? "renameParameters" : "other";
    case "renameParameters":
      return key === "keys" ? "renameKeys" : "other";
    case "renameKeys":
      return key === "key" ? "renameKeyList" : "other";
    case "renameKeyList":
      return key === null ? "renameEntry" : "other";
    default:
      return "other";
  }
}

export function renderForScan(value: ScanInput): string {
  const lines: string[] = [];
  const stack: Frame[] = [{ value, name: "", position: "root", depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const current = frame.value;
    // An absent optional property is not JSON: nothing to scan.
    if (current === undefined) continue;
    if (frame.depth > SCAN_MAX_DEPTH) throw new ScanRenderError();
    if (isScalar(current)) {
      lines.push(line(frame.name, current));
      // S3aR-5: the reply body is one JSON text; render its leaves too.
      if (frame.position === "respondBody" && typeof current === "string") {
        const body = parsedBody(current);
        if (body !== undefined) stack.push({ value: body, name: frame.name, position: "other", depth: frame.depth + 1 });
      }
      continue;
    }
    const children: Frame[] = [];
    if (isObject(current)) {
      const name = own(current, "name");
      const pairValue = own(current, "value");
      if (typeof name === "string" && pairValue !== undefined && isScalar(pairValue)) lines.push(line(name, pairValue));
      const fieldId = own(current, "fieldId");
      const fieldValue = own(current, "fieldValue");
      if (typeof fieldId === "string" && fieldValue !== undefined && isScalar(fieldValue)) {
        lines.push(line(fieldId, fieldValue));
      }
      for (const key of Object.keys(current)) {
        const child = own(current, key);
        children.push({
          value: child,
          name: renamed(frame.position, key),
          position:
            frame.position === "respondParameters" && key === "responseBody"
              ? "respondBody"
              : childPosition(frame.position, key, child),
          depth: frame.depth + 1,
        });
      }
    } else {
      for (const child of current) {
        children.push({
          value: child,
          name: frame.name,
          position: childPosition(frame.position, null, child),
          depth: frame.depth + 1,
        });
      }
    }
    // Reverse so the stack pops children in insertion order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return lines.join("\n");
}

/**
 * The scan F9, validator rule 7, and `assertExportSafe` run: the secret
 * scanner over the shared rendering. Never throws: input too deep to render
 * counts as a finding (fail closed, R3aR-1).
 */
export function scanFindsSecret(path: string, value: ScanInput): boolean {
  let text: string;
  try {
    text = renderForScan(value);
  } catch (error) {
    if (error instanceof ScanRenderError) return true;
    throw error;
  }
  return scan(path, text).findings.length > 0;
}

/**
 * True when any object at any depth has an own key `__proto__`,
 * `constructor`, or `prototype` (validator rule 1, `assertExportSafe` shape).
 * Iterative; reads own keys only.
 */
export function hasReservedKey(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const child of current) stack.push(child);
    } else if (current !== null && typeof current === "object") {
      for (const key of Object.keys(current)) {
        if (RESERVED_KEYS.has(key)) return true;
        stack.push((current as Record<string, unknown>)[key]);
      }
    }
  }
  return false;
}
