/**
 * Readiness gate for the Phase 2 analysis UI (review R11-2). The project page
 * keeps the Phase 1 disabled Analyze button and never calls
 * `POST /api/projects/:id/analyze` until docs/status.md marks the Analyze API
 * ready. Flip to `true` in the same change that switches the UI to the live API.
 * A function (not a constant) so tests can exercise both states.
 */
export function isAnalyzeApiReady(): boolean {
  return false;
}
