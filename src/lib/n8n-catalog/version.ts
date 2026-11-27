/**
 * The n8n pin (docs/node-catalog.md "How the catalog is built", D-38).
 * `scripts/generate-node-catalog.mjs` and `scripts/n8n-import-test.mjs` read
 * these constants from this file's text, so keep each on one line as a plain
 * string literal. Bumping the pin: regenerate the catalog, fix the profiles
 * the consistency test flags, and re-run the dev import test. Runtime-neutral.
 */

/** The `latest` dist-tag of the npm package `n8n` on 2026-11-25 (OQ-7). */
export const N8N_VERSION = "2.49.5";

/** The exact `n8n-nodes-base` version that `n8n@N8N_VERSION` depends on. */
export const NODES_BASE_VERSION = "2.49.5";

/** The `fm<n>` suffix is bumped whenever a node profile changes. */
export const CATALOG_VERSION = "2.49.5+fm2";
