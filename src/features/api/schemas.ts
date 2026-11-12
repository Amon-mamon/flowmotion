import { z } from "zod";

export { errorCodeSchema, type ErrorCode } from "@/schemas/api";

/**
 * Lenient envelope parser for the client: error `code` is any string so an
 * unexpected code still surfaces as an ApiError instead of a parse failure.
 * Shared strict schemas live in src/schemas/api.ts.
 */
export const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string().min(1), message: z.string() }) }),
]);
