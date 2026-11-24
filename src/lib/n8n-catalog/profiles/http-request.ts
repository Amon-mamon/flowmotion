import { z } from "zod";

import { boundedText, pairSchema, placeholderSchema, uniqueNames, type Pair } from "@/lib/flowspec/values";

import { asString, defineProfile, one, unnamed, type N8nParameters } from "./types";
import { HTTP_METHODS } from "./webhook";

/** Authentication is added by the user in n8n, never by a generated flow. */
export const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
]);

function keypairs(pairs: readonly Pair[]): N8nParameters {
  return { parameters: pairs.map((pair) => ({ name: pair.name, value: asString(pair.value) })) };
}

const pairs = (max: number) => z.array(pairSchema).max(max).refine(uniqueNames, { message: "Duplicate name" });

export const httpRequestProfile = defineProfile({
  name: "httpRequest",
  tier: 2,
  typeVersion: 4.5,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  // Optional in n8n: the user adds authentication after import.
  credential: null,
  paramsSchema: z.strictObject({
    method: z.enum(HTTP_METHODS),
    baseUrl: placeholderSchema.refine((value) => value.endsWith("_URL"), { message: "Must end in _URL" }),
    path: boundedText(1, 500).refine((value) => value.startsWith("/"), { message: "Must start with /" }),
    query: pairs(10).optional(),
    headers: pairs(10)
      .refine((items) => items.every((item) => !FORBIDDEN_HEADER_NAMES.has(item.name.toLowerCase())), {
        message: "Authentication headers are not allowed",
      })
      .optional(),
    jsonBody: pairs(20).optional(),
  }),
  toParameters: (params) => {
    const parameters: N8nParameters = {
      method: params.method,
      url: `${params.baseUrl}${params.path}`,
      authentication: "none",
    };
    if (params.query !== undefined && params.query.length > 0) {
      parameters.sendQuery = true;
      parameters.specifyQuery = "keypair";
      parameters.queryParameters = keypairs(params.query);
    }
    if (params.headers !== undefined && params.headers.length > 0) {
      parameters.sendHeaders = true;
      parameters.specifyHeaders = "keypair";
      parameters.headerParameters = keypairs(params.headers);
    }
    if (params.jsonBody !== undefined && params.jsonBody.length > 0) {
      parameters.sendBody = true;
      parameters.contentType = "json";
      parameters.specifyBody = "keypair";
      parameters.bodyParameters = keypairs(params.jsonBody);
    }
    parameters.options = {};
    return parameters;
  },
  promptReference:
    'httpRequest: calls an HTTP API. params: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", baseUrl: Placeholder ending in _URL (for example YOUR_APP_URL; never a literal host), path: Text starting with "/", query?: Pair[0..10], headers?: Pair[0..10], jsonBody?: Pair[0..20] }. Never set authorization, proxy-authorization, cookie, or x-api-key headers: the user adds authentication in n8n.',
});
