import { z } from "zod";

import generated from "./catalog.generated.json" with { type: "json" };

/**
 * Typed access to the generated catalog (`catalog.generated.json`, written by
 * `npm run catalog:generate`, never hand-edited). Runtime-neutral.
 */

export interface PropertyDef {
  name: string;
  type: string;
  options?: (string | number | boolean)[];
  children?: PropertyDef[];
}

const propertyDefSchema: z.ZodType<PropertyDef> = z.lazy(() =>
  z.strictObject({
    name: z.string(),
    type: z.string(),
    options: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    children: z.array(propertyDefSchema).optional(),
  }),
);

/** A count, or "dynamic" when n8n computes it from the node's parameters. */
const connectionCountSchema = z.union([z.number().int().nonnegative(), z.literal("dynamic")]);

const catalogNodeSchema = z.strictObject({
  typeVersion: z.number().positive(),
  displayName: z.string(),
  inputs: connectionCountSchema,
  outputs: connectionCountSchema,
  /** n8n credential type names. */
  credentials: z.array(z.string()),
  properties: z.array(propertyDefSchema),
});
export type CatalogNode = z.infer<typeof catalogNodeSchema>;

const catalogSchema = z.strictObject({
  n8nVersion: z.string(),
  nodesBaseVersion: z.string(),
  nodes: z.record(z.string(), catalogNodeSchema),
});
export type NodeCatalog = z.infer<typeof catalogSchema>;

export const NODE_CATALOG: NodeCatalog = catalogSchema.parse(generated);

export function catalogNode(type: string): CatalogNode | undefined {
  return Object.hasOwn(NODE_CATALOG.nodes, type) ? NODE_CATALOG.nodes[type] : undefined;
}
