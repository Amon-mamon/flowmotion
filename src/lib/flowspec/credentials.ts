import type { CredentialName } from "@/lib/n8n-catalog/allowlist";
import { nodeProfile } from "@/lib/n8n-catalog/profiles";
import type { FlowSpecNode, RequiredCredential } from "@/schemas/flowspec";

/**
 * The credentials a flow needs, computed from the node profiles and never
 * taken from the model (docs/contract.md section 7). Ordered by first use;
 * `usedBy` holds node keys in spec order.
 */
export function computeRequiredCredentials(nodes: readonly FlowSpecNode[]): RequiredCredential[] {
  const byType = new Map<CredentialName, string[]>();
  for (const node of nodes) {
    const credential = nodeProfile(node.nodeType)?.credential ?? null;
    if (credential === null) continue;
    const usedBy = byType.get(credential);
    if (usedBy === undefined) byType.set(credential, [node.key]);
    else usedBy.push(node.key);
  }
  return [...byType.entries()].map(([type, usedBy]) => ({ type, usedBy }));
}
