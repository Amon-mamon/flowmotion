import type { z } from "zod";

import type { AllowedNodeType, CredentialName } from "@/lib/n8n-catalog/allowlist";
import { NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import type { Value } from "@/lib/flowspec/values";
import type { JsonValue } from "@/schemas/flow";

/**
 * Node profiles (docs/node-catalog.md, D-38): one per allowed node. Each holds
 * the strict schema for the node's FlowSpec params and the function that turns
 * them into n8n parameters for the pinned `typeVersion`. Flow Motion supports
 * one small, fixed set of operations per node. Runtime-neutral.
 *
 * `toParameters` never adds the `=` expression prefix: the compiler does, on
 * every emitted string that contains `{{` (contract section 8).
 */

export type N8nParameters = Record<string, JsonValue>;

export interface NodeProfileDefinition<P> {
  /** Short node name, for example "slack". */
  name: string;
  tier: 1 | 2;
  /** Must equal the generated catalog's (consistency test). */
  typeVersion: number;
  isTrigger: boolean;
  inputs: number;
  outputs: (params: P) => number;
  /** length = outputs; "" when unnamed. */
  outputLabels: (params: P) => string[];
  credential: CredentialName | null;
  paramsSchema: z.ZodType<P>;
  toParameters: (params: P) => N8nParameters;
  /** One short text block for the model. */
  promptReference: string;
}

/**
 * A profile with its params type erased, so all 32 fit one index. The
 * functions parse `params` with `paramsSchema` first and throw a ZodError when
 * they do not match; callers check `paramsSchema.safeParse` before.
 */
export interface NodeProfile {
  type: AllowedNodeType;
  tier: 1 | 2;
  typeVersion: number;
  isTrigger: boolean;
  inputs: number;
  outputs: (params: unknown) => number;
  outputLabels: (params: unknown) => string[];
  credential: CredentialName | null;
  paramsSchema: z.ZodType;
  toParameters: (params: unknown) => N8nParameters;
  promptReference: string;
}

export function defineProfile<P>(definition: NodeProfileDefinition<P>): NodeProfile {
  return {
    type: `${NODE_TYPE_PREFIX}${definition.name}` as AllowedNodeType,
    tier: definition.tier,
    typeVersion: definition.typeVersion,
    isTrigger: definition.isTrigger,
    inputs: definition.inputs,
    outputs: (params) => definition.outputs(definition.paramsSchema.parse(params)),
    outputLabels: (params) => definition.outputLabels(definition.paramsSchema.parse(params)),
    credential: definition.credential,
    paramsSchema: definition.paramsSchema,
    toParameters: (params) => definition.toParameters(definition.paramsSchema.parse(params)),
    promptReference: definition.promptReference,
  };
}

export const one = (): number => 1;
export const unnamed = (): string[] => [""];

/** n8n string fields take text; numbers and booleans are written out. */
export function asString(value: Value): string {
  return typeof value === "string" ? value : String(value);
}

/** An n8n resource locator holding a fixed value. */
export function locator(mode: "id" | "name", value: string): N8nParameters {
  return { __rl: true, mode, value };
}

/**
 * A 128-bit FNV-1a style hash of `seed`, formatted like a UUID. Deterministic
 * and synchronous (no Web Crypto needed), so compiled output is byte-stable.
 * Not a security primitive: it only makes stable, well-formed ids.
 */
export function stableId(seed: string): string {
  let hex = "";
  for (let round = 0; round < 4; round += 1) {
    let hash = 0x811c9dc5 ^ (round * 0x9e3779b1);
    const salted = `${round}:${seed}`;
    for (let index = 0; index < salted.length; index += 1) {
      hash ^= salted.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hex += (hash >>> 0).toString(16).padStart(8, "0");
  }
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
