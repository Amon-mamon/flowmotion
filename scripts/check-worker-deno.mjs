// R2-7 / OQ-16: type-checks the worker Edge Function under Deno when Deno is
// installed. Without Deno it prints "skipped: deno not installed" and exits 0.
// Usage: npm run check:worker-deno
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "deno",
  ["check", "--import-map", "supabase/functions/import_map.json", "supabase/functions/worker/index.ts"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error !== undefined && result.error.code === "ENOENT") {
  console.log("skipped: deno not installed");
  process.exit(0);
}
if (process.platform === "win32" && result.status !== 0) {
  // With a shell, a missing command surfaces as a non-zero status, not ENOENT.
  const probe = spawnSync("deno", ["--version"], { shell: true, stdio: "ignore" });
  if (probe.status !== 0) {
    console.log("skipped: deno not installed");
    process.exit(0);
  }
}
process.exit(result.status ?? 1);
