/**
 * The one gate for the Generate API (contract section 11, Phase 3a item 5).
 * `POST /api/recommendations/generate` arrives in Phase 3b; until docs/status.md
 * says "Generate API: yes" the card button is disabled with a hint. Phase 3b
 * removes this file and its disabled branch.
 */
export function isGenerateApiReady(): boolean {
  return false;
}
