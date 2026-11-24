import type { JsonValue } from "@/schemas/flow";

/** The n8n export format (docs/contract.md section 8). */

export interface N8nConnectionTarget {
  node: string;
  type: "main";
  index: number;
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, JsonValue>;
}

export interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnectionTarget[][] }>;
  settings: { executionOrder: "v1" };
}
