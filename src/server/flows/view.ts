import "server-only";

import { layoutFlow } from "@/lib/compiler/layout";
import { normalizeEdges } from "@/lib/flowspec/graph";
import { importVerified } from "@/lib/n8n-catalog/import-verified";
import { nodeProfile } from "@/lib/n8n-catalog/profiles";
import { toIso } from "@/server/db-rows";
import { parseJobErrorCode, type FlowDetailRow, type FlowLinks } from "@/server/flows/data";
import { logServerInfo } from "@/server/log";
import {
  setupChecklistSchema,
  type FlowDetail,
  type FlowEdgeView,
  type FlowNodeView,
  type SetupChecklist,
} from "@/schemas/flow";
import { flowSpecSchema, type FlowSpec } from "@/schemas/flowspec";

/**
 * Builds the `FlowDetail` DTO for `GET /api/flows/:id` (contract section 6).
 * Nodes, edges and positions are derived at read time from the stored
 * `flow_spec` with the node profiles and the compiler's layout function, so
 * the canvas and the export agree. The raw `flow_spec`, `tests` and
 * `n8n_json` are never in the DTO. This is the only module that imports
 * `importVerified` (R3a-9).
 */

interface Drawn {
  nodes: FlowNodeView[];
  edges: FlowEdgeView[];
}

/** Nodes and edges for the canvas, or null when the stored spec cannot be drawn. */
export function drawFlowSpec(spec: FlowSpec): Drawn | null {
  const positions = layoutFlow(spec.nodes, spec.edges);
  const nodes: FlowNodeView[] = [];
  for (const node of spec.nodes) {
    const profile = nodeProfile(node.nodeType);
    if (profile === undefined || !profile.paramsSchema.safeParse(node.params).success) return null;
    const position = positions.get(node.key) ?? { x: 0, y: 0 };
    nodes.push({
      key: node.key,
      label: node.label,
      nodeType: node.nodeType,
      tier: profile.tier,
      isTrigger: profile.isTrigger,
      params: node.params,
      credential: profile.credential,
      sourceFiles: node.sourceFiles ?? [],
      notes: node.notes ?? null,
      position: { x: position.x, y: position.y },
      inputs: profile.inputs,
      outputs: profile.outputs(node.params),
      outputLabels: profile.outputLabels(node.params),
    });
  }
  const edges: FlowEdgeView[] = normalizeEdges(spec.edges).map((edge) => ({
    id: `${edge.from}:${edge.output}->${edge.to}:${edge.input}`,
    from: edge.from,
    to: edge.to,
    output: edge.output,
    input: edge.input,
  }));
  return { nodes, edges };
}

export function buildFlowDetail(row: FlowDetailRow, links: FlowLinks): FlowDetail {
  const parsedSpec = row.flow_spec === null ? null : flowSpecSchema.safeParse(row.flow_spec);
  const spec = parsedSpec?.success === true ? parsedSpec.data : null;
  let drawn: Drawn | null = null;
  let checklist: SetupChecklist | null = null;
  if (row.status === "ready") {
    const parsedChecklist = setupChecklistSchema.safeParse(row.setup_checklist);
    drawn = spec === null ? null : drawFlowSpec(spec);
    checklist = parsedChecklist.success ? parsedChecklist.data : null;
    if (drawn === null || checklist === null) {
      // Never expected for a `ready` flow; logged by id only.
      logServerInfo("flows.view", { flowId: row.id, code: "STORED_FLOW_UNREADABLE" });
      drawn = null;
      checklist = null;
    }
  }
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    analysisId: links.analysisId,
    projectId: links.projectId,
    repoFullName: links.repoFullName,
    name: row.name,
    description: spec?.description ?? null,
    status: row.status,
    errorCode: parseJobErrorCode(row.error_code),
    n8nVersion: row.n8n_version,
    catalogVersion: row.catalog_version,
    importVerified: importVerified(),
    nodes: drawn?.nodes ?? [],
    edges: drawn?.edges ?? [],
    checklist,
    // Phase 4 adds test runs; none exist in Phase 3.
    latestTestRun: null,
    createdAt: toIso(row.created_at),
  };
}
