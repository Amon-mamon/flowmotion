import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileFlow, type CompiledFlow } from "@/lib/compiler";
import { checkFlowSpec } from "@/lib/flowspec";
import { flowSpecDraftSchema, type FlowSpec, type FlowSpecDraft } from "@/schemas/flowspec";

/** Shared loaders for the conformance set (tests/conformance/). Test-only: uses node:fs. */

/** vitest runs from the repository root. */
export const CONFORMANCE_DIR = `${resolve(process.cwd(), "tests", "conformance")}/`;
const SPECS_DIR = `${CONFORMANCE_DIR}specs/`;

export const SPEC_NAMES: string[] = readdirSync(SPECS_DIR)
  .filter((file) => file.endsWith(".flowspec.json"))
  .map((file) => file.slice(0, -".flowspec.json".length))
  .sort();

export function goldenPath(name: string): string {
  return `${CONFORMANCE_DIR}${name}.n8n.json`;
}

export function loadDraft(name: string): FlowSpecDraft {
  const raw: unknown = JSON.parse(readFileSync(`${SPECS_DIR}${name}.flowspec.json`, "utf8"));
  return flowSpecDraftSchema.parse(raw);
}

export function loadSpec(name: string): FlowSpec {
  const result = checkFlowSpec(loadDraft(name));
  if (!result.ok) throw new Error(`Conformance spec ${name} fails ${JSON.stringify(result.errors)}`);
  return result.spec;
}

export function compileSpec(name: string): CompiledFlow {
  return compileFlow(loadSpec(name));
}

/** A deep copy that tests may mutate. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A minimal valid draft: manual trigger → set. */
export function baseDraft(): FlowSpecDraft {
  return {
    version: 1,
    name: "Example flow",
    description: "A tiny flow used by the unit tests.",
    nodes: [
      { key: "start", nodeType: "n8n-nodes-base.manualTrigger", label: "Start", params: {} },
      {
        key: "shape",
        nodeType: "n8n-nodes-base.set",
        label: "Shape",
        params: { fields: [{ name: "greeting", value: "hello" }], keepOtherFields: true },
      },
    ],
    edges: [{ from: "start", to: "shape" }],
    tests: {
      cases: [
        {
          name: "Runs",
          trigger: { kind: "manual", payload: {} },
          mocks: {},
          expect: { reachedNodes: ["start", "shape"] },
        },
      ],
    },
  };
}
