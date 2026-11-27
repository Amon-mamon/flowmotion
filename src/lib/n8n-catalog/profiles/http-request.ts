import { z } from "zod";

import { boundedText, pairSchema, placeholderSchema, uniqueNames, type Pair } from "@/lib/flowspec/values";

import { asString, defineProfile, one, unnamed, type N8nParameters } from "./types";
import { HTTP_METHODS } from "./webhook";

/**
 * Header rule (D-51, S3a-5, OQ-28): names stay `FieldName` (no `-`) and are
 * refused when, lowercased, they equal a routing header or contain a
 * credential word. Authentication is added by the user in n8n.
 */
export const FORBIDDEN_HEADER_EXACT: ReadonlySet<string> = new Set([
  "host",
  "forwarded",
  "te",
  "connection",
  "upgrade",
  "expect",
]);
export const FORBIDDEN_HEADER_PARTS: readonly string[] = [
  "auth",
  "token",
  "secret",
  "key",
  "cookie",
  "session",
  "password",
  "passwd",
  "signature",
];

/**
 * S3aR-4: routing, method-override, and framing headers. Matched after `_`
 * is read as `-`, because CGI-style back ends treat the two alike
 * (`X_Forwarded_For` reaches them as `X-Forwarded-For`).
 */
export const FORBIDDEN_HEADER_PREFIXES: readonly string[] = [
  "x-forwarded",
  "x-real-ip",
  "x-original",
  "x-rewrite",
  "x-http-method",
  "x-method-override",
  "transfer-encoding",
  "content-length",
  "proxy-",
];

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  const normalized = lower.replace(/_/g, "-");
  return (
    FORBIDDEN_HEADER_EXACT.has(lower) ||
    FORBIDDEN_HEADER_EXACT.has(normalized) ||
    FORBIDDEN_HEADER_PARTS.some((part) => lower.includes(part)) ||
    FORBIDDEN_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

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
      .refine((items) => items.every((item) => !isForbiddenHeaderName(item.name)), {
        message: "Authentication and routing headers are not allowed",
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
    'httpRequest: calls an HTTP API. params: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", baseUrl: Placeholder ending in _URL (for example YOUR_APP_URL; never a literal host), path: Text starting with "/", query?: Pair[0..10], headers?: Pair[0..10], jsonBody?: Pair[0..20] }. Header names are FieldNames (no "-"); never Host, Forwarded, TE, Connection, Upgrade, Expect, or a name containing auth, token, secret, key, cookie, session, password, passwd, or signature: the user adds authentication in n8n. No "://" in any text.',
});
