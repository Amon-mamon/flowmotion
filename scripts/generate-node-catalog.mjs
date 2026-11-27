// D-38: builds src/lib/n8n-catalog/catalog.generated.json from the pinned
// n8n-nodes-base package. The package is installed into a temporary directory
// outside the repo (never package.json, never the lockfile) with
// --ignore-scripts, and only its static description file
// (dist/types/nodes.json) is read: no code from the package is executed.
// The output is byte-stable: no timestamp, sorted keys, sorted lists.
// Usage: npm run catalog:generate
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = join(repoRoot, "src", "lib", "n8n-catalog");
const PREFIX = "n8n-nodes-base.";
/** Display-only entries, not parameters. */
const NON_PARAMETER_TYPES = new Set(["notice", "callout"]);

class GenerateError extends Error {}

/** True once the temporary directory exists: a failure must then throw so `finally` removes it (S3a-9). */
let insideTempDir = false;

function fail(message) {
  if (insideTempDir) throw new GenerateError(message);
  console.error(`catalog:generate failed: ${message}`);
  process.exit(1);
}

function readConstant(text, name) {
  const match = new RegExp(`export const ${name} = "([^"]+)";`).exec(text);
  if (match === null) fail(`${name} not found in version.ts`);
  return match[1];
}

function readNameList(text, name) {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(text);
  if (match === null) fail(`${name} not found in allowlist.ts`);
  return [...match[1].matchAll(/"([A-Za-z0-9]+)"/g)].map((item) => item[1]);
}

function isPrimitive(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function comparePrimitive(a, b) {
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Merges definitions that share a name and a type (n8n repeats them per resource / operation). */
function mergeProperties(rawList) {
  const byKey = new Map();
  for (const raw of rawList) {
    if (raw === null || typeof raw !== "object") continue;
    if (typeof raw.name !== "string" || typeof raw.type !== "string") continue;
    if (NON_PARAMETER_TYPES.has(raw.type)) continue;
    const key = `${raw.name}\u0000${raw.type}`;
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { name: raw.name, type: raw.type, optionValues: [], childLists: [] };
      byKey.set(key, entry);
    }
    const options = Array.isArray(raw.options) ? raw.options : [];
    if (raw.type === "options" || raw.type === "multiOptions") {
      for (const option of options) {
        if (option !== null && typeof option === "object" && isPrimitive(option.value)) {
          entry.optionValues.push(option.value);
        }
      }
    } else if (raw.type === "collection") {
      entry.childLists.push(options);
    } else if (raw.type === "fixedCollection") {
      // Each option is a named group of values.
      entry.childLists.push(
        options
          .filter((group) => group !== null && typeof group === "object" && typeof group.name === "string")
          .map((group) => ({
            name: group.name,
            type: "fixedCollectionGroup",
            groupValues: Array.isArray(group.values) ? group.values : [],
          })),
      );
    }
    if (raw.type === "fixedCollectionGroup") {
      entry.childLists.push(raw.groupValues);
    }
  }
  const result = [];
  for (const entry of byKey.values()) {
    const def = { name: entry.name, type: entry.type };
    if (entry.optionValues.length > 0) {
      const unique = [...new Set(entry.optionValues.map((value) => `${typeof value}:${String(value)}`))];
      const values = unique.map((tagged) => {
        const index = tagged.indexOf(":");
        const kind = tagged.slice(0, index);
        const text = tagged.slice(index + 1);
        if (kind === "number") return Number(text);
        if (kind === "boolean") return text === "true";
        return text;
      });
      def.options = values.sort(comparePrimitive);
    }
    const children = mergeProperties(entry.childLists.flat());
    if (children.length > 0) def.children = children;
    result.push(def);
  }
  return result.sort((a, b) => comparePrimitive(a.name, b.name) || comparePrimitive(a.type, b.type));
}

function versionsOf(entry) {
  return Array.isArray(entry.version) ? entry.version : [entry.version];
}

function connectionCount(value) {
  return Array.isArray(value) ? value.length : "dynamic";
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

const versionText = readFileSync(join(catalogDir, "version.ts"), "utf8");
const allowlistText = readFileSync(join(catalogDir, "allowlist.ts"), "utf8");
const n8nVersion = readConstant(versionText, "N8N_VERSION");
const nodesBaseVersion = readConstant(versionText, "NODES_BASE_VERSION");
const allowlisted = [
  ...readNameList(allowlistText, "TIER1_NODE_NAMES"),
  ...readNameList(allowlistText, "TIER2_NODE_NAMES"),
];
if (allowlisted.length === 0) fail("the allowlist is empty");
if (!/^\d+\.\d+\.\d+$/.test(nodesBaseVersion)) fail("NODES_BASE_VERSION is not an exact version");

const tempDir = mkdtempSync(join(tmpdir(), "flowmotion-catalog-"));
insideTempDir = true;
let failure = null;
try {
  console.log(`Installing n8n-nodes-base@${nodesBaseVersion} into a temporary directory...`);
  const install = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      tempDir,
      "--no-save",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `n8n-nodes-base@${nodesBaseVersion}`,
    ],
    { cwd: tempDir, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
  );
  if (install.error !== undefined || install.status !== 0) {
    fail("npm install of n8n-nodes-base did not succeed (network needed). The catalog was not changed.");
  }

  const packageDir = join(tempDir, "node_modules", "n8n-nodes-base");
  const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (installed.version !== nodesBaseVersion) {
    fail(`installed n8n-nodes-base ${String(installed.version)}, expected ${nodesBaseVersion}`);
  }
  const descriptions = JSON.parse(readFileSync(join(packageDir, "dist", "types", "nodes.json"), "utf8"));
  if (!Array.isArray(descriptions)) fail("dist/types/nodes.json is not a list");

  const nodes = {};
  const missing = [];
  for (const shortName of allowlisted) {
    const entries = descriptions.filter(
      (entry) => entry !== null && typeof entry === "object" && (entry.name === shortName || entry.name === PREFIX + shortName),
    );
    if (entries.length === 0) {
      missing.push(shortName);
      continue;
    }
    const allVersions = entries.flatMap(versionsOf).filter((version) => typeof version === "number");
    const declared = entries.map((entry) => entry.defaultVersion).find((version) => typeof version === "number");
    const typeVersion = declared ?? Math.max(...allVersions);
    const chosen = entries.find((entry) => versionsOf(entry).includes(typeVersion));
    if (chosen === undefined) fail(`no description of ${shortName} at version ${String(typeVersion)}`);
    nodes[PREFIX + shortName] = {
      typeVersion,
      displayName: String(chosen.displayName),
      inputs: connectionCount(chosen.inputs),
      outputs: connectionCount(chosen.outputs),
      credentials: (Array.isArray(chosen.credentials) ? chosen.credentials : [])
        .map((credential) => credential.name)
        .filter((name) => typeof name === "string")
        .sort(),
      properties: mergeProperties(Array.isArray(chosen.properties) ? chosen.properties : []),
    };
  }
  if (missing.length > 0) {
    fail(`allowlisted types missing from n8n-nodes-base@${nodesBaseVersion}: ${missing.join(", ")}`);
  }

  const output = `${JSON.stringify(sortKeys({ n8nVersion, nodesBaseVersion, nodes }), null, 2)}\n`;
  writeFileSync(join(catalogDir, "catalog.generated.json"), output, "utf8");
  console.log(`Wrote catalog.generated.json: ${Object.keys(nodes).length} node types, n8n ${n8nVersion}.`);
} catch (error) {
  failure = error;
} finally {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
}
// Exit code set only after the cleanup above.
if (failure !== null) {
  const message = failure instanceof GenerateError ? failure.message : String(failure);
  console.error(`catalog:generate failed: ${message}`);
  process.exitCode = 1;
}
