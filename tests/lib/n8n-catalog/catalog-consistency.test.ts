// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ALLOWED_NODE_TYPES, CREDENTIAL_NAMES, NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import { NODE_CATALOG } from "@/lib/n8n-catalog/catalog";
import { importVerified } from "@/lib/n8n-catalog/import-verified";
import { buildNodeReference, NODE_PROFILES } from "@/lib/n8n-catalog/profiles";
import { CATALOG_VERSION, N8N_VERSION, NODES_BASE_VERSION } from "@/lib/n8n-catalog/version";

import { compileSpec, SPEC_NAMES } from "../flow/helpers";

const doc = readFileSync(resolve(process.cwd(), "docs", "node-catalog.md"), "utf8");

function section(start: string, end: string): string {
  const from = doc.indexOf(start);
  const to = doc.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThan(-1);
  expect(to, end).toBeGreaterThan(from);
  return doc.slice(from, to);
}

/** The first cell of every table row: "| `name` | …". */
function tableTypes(text: string): string[] {
  return [...text.matchAll(/^\| `([A-Za-z0-9]+)` \|/gm)].map((match) => `${NODE_TYPE_PREFIX}${match[1]}`);
}

const docTier1 = tableTypes(section("## Tier 1", "## Tier 2"));
const docTier2 = tableTypes(section("## Tier 2", "## Excluded"));
const docTypes = [...docTier1, ...docTier2];
const sorted = (list: readonly string[]) => [...list].sort();

describe("catalog consistency (D-38)", () => {
  it("node-catalog.md, the allowlist, the generated catalog, and the profile index list the same 32 types", () => {
    expect(docTier1).toHaveLength(20);
    expect(docTier2).toHaveLength(12);
    expect(new Set(docTypes).size).toBe(32);
    expect(sorted(ALLOWED_NODE_TYPES)).toEqual(sorted(docTypes));
    expect(sorted(Object.keys(NODE_CATALOG.nodes))).toEqual(sorted(docTypes));
    expect(sorted(Object.keys(NODE_PROFILES))).toEqual(sorted(docTypes));
  });

  it("every profile is filed under its own type, with the tier from node-catalog.md", () => {
    for (const [type, profile] of Object.entries(NODE_PROFILES)) {
      expect(profile.type, type).toBe(type);
      expect(profile.tier, type).toBe(docTier1.includes(type) ? 1 : 2);
    }
  });

  it("every profile typeVersion equals the catalog's", () => {
    for (const [type, profile] of Object.entries(NODE_PROFILES)) {
      expect(profile.typeVersion, type).toBe(NODE_CATALOG.nodes[type]?.typeVersion);
    }
  });

  it("profile input and output counts agree with the catalog where the catalog has a fixed count", () => {
    for (const [type, profile] of Object.entries(NODE_PROFILES)) {
      const node = NODE_CATALOG.nodes[type];
      if (typeof node?.inputs === "number") expect(profile.inputs, type).toBe(node.inputs);
      expect(profile.isTrigger, type).toBe(profile.inputs === 0);
    }
    expect(NODE_PROFILES["n8n-nodes-base.merge"].inputs).toBe(2);
    expect(NODE_CATALOG.nodes["n8n-nodes-base.if"]?.outputs).toBe(2);
    expect(NODE_CATALOG.nodes["n8n-nodes-base.splitInBatches"]?.outputs).toBe(2);
    expect(NODE_CATALOG.nodes["n8n-nodes-base.stopAndError"]?.outputs).toBe(0);
  });

  it("credentials: tier 1 has none; tier 2 names match node-catalog.md and exist in n8n", () => {
    const rows = [...section("## Tier 2", "## Excluded").matchAll(/^\| `([A-Za-z0-9]+)` \|[^|]*\| ([A-Za-z]+) \|$/gm)];
    expect(rows).toHaveLength(12);
    for (const [, name, credential] of rows) {
      const type = `${NODE_TYPE_PREFIX}${name}` as keyof typeof NODE_PROFILES;
      const profile = NODE_PROFILES[type];
      if (credential === "optional") {
        expect(profile.credential, type).toBeNull();
      } else {
        expect(profile.credential, type).toBe(credential);
        expect(CREDENTIAL_NAMES as readonly string[]).toContain(credential);
        expect(NODE_CATALOG.nodes[type]?.credentials.length, type).toBeGreaterThan(0);
      }
    }
    for (const type of docTier1) {
      expect(NODE_PROFILES[type as keyof typeof NODE_PROFILES].credential, type).toBeNull();
    }
  });

  it("every excluded type in node-catalog.md is absent from the allowlist, the catalog, and the profiles", () => {
    const paragraph = section("## Excluded", "## Mapping").replace(/\([^)]*\)/g, "");
    const excluded = [...paragraph.matchAll(/`([A-Za-z0-9]+)`/g)].map((match) => `${NODE_TYPE_PREFIX}${match[1]}`);
    expect(excluded).toEqual(
      ["code", "executeCommand", "readWriteFile", "ssh", "ftp", "executeWorkflow", "errorTrigger", "localFileTrigger"].map(
        (name) => `${NODE_TYPE_PREFIX}${name}`,
      ),
    );
    for (const type of excluded) {
      expect(ALLOWED_NODE_TYPES as readonly string[]).not.toContain(type);
      expect(Object.keys(NODE_CATALOG.nodes)).not.toContain(type);
      expect(Object.keys(NODE_PROFILES)).not.toContain(type);
    }
  });

  it("every top-level parameter a golden export emits exists in that node's catalog properties", () => {
    const seen = new Set<string>();
    for (const name of SPEC_NAMES) {
      for (const node of compileSpec(name).workflow.nodes) {
        seen.add(node.type);
        const known = new Set(NODE_CATALOG.nodes[node.type]?.properties.map((property) => property.name));
        for (const parameter of Object.keys(node.parameters)) {
          expect(known.has(parameter), `${node.type}.${parameter}`).toBe(true);
        }
      }
    }
    expect(sorted([...seen])).toEqual(sorted(docTypes));
  });

  it("the pin is consistent", () => {
    expect(NODE_CATALOG.n8nVersion).toBe(N8N_VERSION);
    expect(NODE_CATALOG.nodesBaseVersion).toBe(NODES_BASE_VERSION);
    expect(CATALOG_VERSION).toMatch(new RegExp(`^${N8N_VERSION.replace(/\./g, "\\.")}\\+fm[1-9][0-9]*$`));
  });

  it("the generated file is byte-stable: sorted keys, no timestamp", () => {
    const text = readFileSync(resolve(process.cwd(), "src", "lib", "n8n-catalog", "catalog.generated.json"), "utf8");
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, child]) => [key, sortKeys(child)]),
        );
      }
      return value;
    };
    expect(text).toBe(`${JSON.stringify(sortKeys(JSON.parse(text)), null, 2)}\n`);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["n8nVersion", "nodes", "nodesBaseVersion"]);
  });

  it("n8n-nodes-base is not a dependency and nothing in src imports it", () => {
    const pkg = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...parsed.dependencies, ...parsed.devDependencies })).not.toContain("n8n-nodes-base");
    expect(Object.keys({ ...parsed.dependencies, ...parsed.devDependencies })).not.toContain("n8n");
    expect(readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8")).not.toContain("node_modules/n8n-nodes-base");
  });

  it("the node reference has one line per node and stays small", () => {
    const reference = buildNodeReference();
    expect(reference.split("\n")).toHaveLength(32);
    expect(reference.length).toBeLessThan(8000);
    expect(buildNodeReference(["n8n-nodes-base.slack"])).toMatch(/^slack: /);
  });
});

describe("importVerified (D-9)", () => {
  it("is false for the committed verified.json until the import test has passed", () => {
    expect(importVerified()).toBe(false);
  });

  it("is true only when the verified version equals the pin", () => {
    expect(importVerified({ n8nVersion: N8N_VERSION, verifiedAt: "2026-11-25T00:00:00.000Z" })).toBe(true);
    expect(importVerified({ n8nVersion: "1.0.0", verifiedAt: "2026-11-25T00:00:00.000Z" })).toBe(false);
    expect(importVerified({ n8nVersion: null, verifiedAt: null })).toBe(false);
    expect(importVerified("nonsense")).toBe(false);
  });
});
