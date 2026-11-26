/**
 * Node type helpers with no `@xyflow/react` import, so presentational pieces
 * (node icon, node card body) can be used on the landing page (contract
 * section 11, Landing redesign F9/F10).
 */

/** "n8n-nodes-base.slack" → "slack" (the part after the last dot). */
export function shortNodeType(nodeType: string): string {
  const index = nodeType.lastIndexOf(".");
  return index === -1 ? nodeType : nodeType.slice(index + 1);
}
