// D-9 dev import test (docs/n8n.md "Allowed now"; contract section 11, Phase 3a
// backend item 8). Internal tooling only: never part of `npm test`, never
// deployed, no user data, no credentials.
//
// Starts the pinned n8n in an isolated temporary user folder (Docker image tag
// N8N_VERSION, or, only with --allow-npx (S3a-9), `npx --yes n8n@N8N_VERSION`
// when Docker is absent), imports
// every golden export in tests/conformance/, checks that the import succeeded
// and that node and connection counts match, then writes
// tests/conformance/verified.json. When no runner is available it prints
// "skipped: no n8n runner available" and exits 0 without touching verified.json.
// Without Docker and without --allow-npx it prints the skip message with a hint
// and exits 0.
// Usage: npm run test:n8n-import [-- --allow-npx]
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const conformanceDir = join(repoRoot, "tests", "conformance");
const SKIPPED = "skipped: no n8n runner available";
const SKIPPED_NO_NPX = "skipped: no n8n runner available (pass --allow-npx to download n8n with npx)";
const ALLOW_NPX = process.argv.slice(2).includes("--allow-npx");
const SHELL = process.platform === "win32";
const TIMEOUT_MS = 20 * 60 * 1000;
const PROBLEM_OUTPUT = /unrecognized node type|unknown node|an error occurred|could not be imported/i;

function fail(message) {
  console.error(`test:n8n-import failed: ${message}`);
  process.exitCode = 1;
}

const versionText = readFileSync(join(repoRoot, "src", "lib", "n8n-catalog", "version.ts"), "utf8");
const versionMatch = /export const N8N_VERSION = "(\d+\.\d+\.\d+)";/.exec(versionText);
if (versionMatch === null) {
  console.error("test:n8n-import failed: N8N_VERSION not found in version.ts");
  process.exit(1);
}
const n8nVersion = versionMatch[1];

const goldens = readdirSync(conformanceDir)
  .filter((file) => file.endsWith(".n8n.json"))
  .sort();
if (goldens.length === 0) {
  console.error("test:n8n-import failed: no golden exports in tests/conformance/");
  process.exit(1);
}

/** Only what a child needs to start: nothing else from the developer's shell reaches n8n. */
function baseEnv() {
  const env = {};
  const names = ["PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "TEMP", "TMP", "TMPDIR"];
  for (const name of names) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

const N8N_ENV = {
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
  N8N_TEMPLATES_ENABLED: "false",
  N8N_PERSONALIZATION_ENABLED: "false",
  N8N_HIRING_BANNER_ENABLED: "false",
  DB_TYPE: "sqlite",
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: SHELL,
    timeout: TIMEOUT_MS,
    env: baseEnv(),
    ...options,
  });
}

function succeeded(result) {
  return result.error === undefined && result.status === 0;
}

const workDir = mkdtempSync(join(tmpdir(), "flowmotion-n8n-import-"));
const importDir = join(workDir, "import");
const userDir = join(workDir, "user");
mkdirSync(importDir);
mkdirSync(userDir);
for (const file of goldens) copyFileSync(join(conformanceDir, file), join(importDir, file));

/** Returns how to run one n8n CLI command (with paths mapped for the runner), or null. */
function pickRunner() {
  const image = `docker.n8n.io/n8nio/n8n:${n8nVersion}`;
  const dockerReady =
    succeeded(run("docker", ["info"], { stdio: "ignore" })) &&
    succeeded(run("docker", ["pull", image], { stdio: "ignore" }));
  if (dockerReady) {
    // The container user must be able to write the user folder and the export file.
    chmodSync(workDir, 0o777);
    chmodSync(userDir, 0o777);
    const flags = ["run", "--rm", "--network", "none", "-v", `${workDir}:/work`, "-e", "N8N_USER_FOLDER=/work/user"];
    for (const [name, value] of Object.entries(N8N_ENV)) flags.push("-e", `${name}=${value}`);
    return {
      name: `docker ${image}`,
      path: (local) => `/work/${local}`,
      n8n: (args) => run("docker", [...flags, image, ...args]),
    };
  }
  // S3a-9: the npx fallback downloads n8n and runs its install scripts, so it is opt-in.
  if (!ALLOW_NPX) return { skip: SKIPPED_NO_NPX };
  if (succeeded(run("npx", ["--version"], { stdio: "ignore" }))) {
    console.log(
      `--allow-npx: downloading n8n@${n8nVersion} and its dependencies from the npm registry with npx ` +
        "(several hundred MB). npm runs the packages' install scripts on this machine.",
    );
    const env = { ...baseEnv(), ...N8N_ENV, N8N_USER_FOLDER: userDir };
    return {
      name: `npx n8n@${n8nVersion}`,
      path: (local) => join(workDir, local),
      n8n: (args) => run("npx", ["--yes", `n8n@${n8nVersion}`, ...args], { env, cwd: workDir }),
    };
  }
  return null;
}

function countConnections(connections) {
  let count = 0;
  for (const entry of Object.values(connections ?? {})) {
    for (const outputs of Object.values(entry ?? {})) {
      for (const targets of Array.isArray(outputs) ? outputs : []) {
        count += Array.isArray(targets) ? targets.length : 0;
      }
    }
  }
  return count;
}

function typeList(workflow) {
  return (workflow.nodes ?? []).map((node) => `${node.type}@${node.typeVersion}`).sort();
}

try {
  const runner = pickRunner();
  // The first call downloads n8n when needed; without a network there is no runner.
  if (runner !== null && "skip" in runner) {
    console.log(runner.skip);
  } else if (runner === null || !succeeded(runner.n8n(["--version"]))) {
    console.log(SKIPPED);
  } else {
    console.log(`Importing ${goldens.length} golden exports into n8n ${n8nVersion} (${runner.name})...`);
    let ok = true;
    for (const file of goldens) {
      const result = runner.n8n(["import:workflow", `--input=${runner.path(`import/${file}`)}`]);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (!succeeded(result) || PROBLEM_OUTPUT.test(output)) {
        ok = false;
        fail(`import of ${file} did not succeed`);
        console.error(output.trim().split("\n").slice(-15).join("\n"));
      }
    }

    if (ok) {
      const exported = runner.n8n(["export:workflow", "--all", `--output=${runner.path("export.json")}`]);
      if (!succeeded(exported)) {
        ok = false;
        fail("export of the imported workflows did not succeed");
      } else {
        const parsed = JSON.parse(readFileSync(join(workDir, "export.json"), "utf8"));
        const imported = Array.isArray(parsed) ? parsed : [parsed];
        for (const file of goldens) {
          const golden = JSON.parse(readFileSync(join(conformanceDir, file), "utf8"));
          const match = imported.find((workflow) => workflow.name === golden.name);
          if (match === undefined) {
            ok = false;
            fail(`${file}: not found in n8n after import`);
          } else if ((match.nodes ?? []).length !== golden.nodes.length) {
            ok = false;
            fail(`${file}: node count ${(match.nodes ?? []).length}, expected ${golden.nodes.length}`);
          } else if (countConnections(match.connections) !== countConnections(golden.connections)) {
            ok = false;
            fail(`${file}: connection count differs after import`);
          } else if (JSON.stringify(typeList(match)) !== JSON.stringify(typeList(golden))) {
            ok = false;
            fail(`${file}: node types or versions differ after import`);
          } else {
            console.log(`ok ${file}`);
          }
        }
      }
    }

    if (ok) {
      const verifiedAt = new Date().toISOString();
      const verified = `{ "n8nVersion": ${JSON.stringify(n8nVersion)}, "verifiedAt": ${JSON.stringify(verifiedAt)} }\n`;
      writeFileSync(join(conformanceDir, "verified.json"), verified, "utf8");
      console.log(`All golden exports import into n8n ${n8nVersion}. Wrote tests/conformance/verified.json (commit it).`);
    }
  }
} finally {
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Files written by the container user may not be removable; the folder is in the system temp directory.
  }
}
