// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ApiError,
  assertOriginAllowed,
  fail,
  getClientIp,
  isOriginAllowed,
  ok,
  parseJsonBody,
  parseParams,
  parseQuery,
  withApi,
} from "@/server/http";
import { ERROR_CODES, ERROR_STATUS, apiFailureSchema, apiResponseSchema } from "@/schemas/api";

const APP_URL = "https://app.example.com";

describe("envelope", () => {
  it("ok() wraps data with ok: true and the given status", async () => {
    const response = ok({ hello: "world" }, 201);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, data: { hello: "world" } });
  });

  it("fail() uses the contract status for every code", async () => {
    for (const code of ERROR_CODES) {
      const response = fail(code);
      expect(response.status).toBe(ERROR_STATUS[code]);
      const body = apiFailureSchema.parse(await response.json());
      expect(body.error.code).toBe(code);
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });

  it("fail() allows a custom message and status override", async () => {
    const response = fail("VALIDATION_ERROR", "Nope", 422);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Nope" },
    });
  });

  it("apiResponseSchema validates both branches", () => {
    const schema = apiResponseSchema(z.object({ n: z.number() }));
    expect(schema.parse({ ok: true, data: { n: 1 } }).ok).toBe(true);
    expect(schema.parse({ ok: false, error: { code: "NOT_FOUND", message: "x" } }).ok).toBe(false);
    expect(schema.safeParse({ ok: false, error: { code: "WHATEVER", message: "x" } }).success).toBe(
      false,
    );
  });
});

describe("Zod parsing", () => {
  const schema = z.object({ displayName: z.string().trim().min(1).max(80) });

  it("parseJsonBody rejects invalid JSON with VALIDATION_ERROR", async () => {
    const request = new Request("https://x/api", { method: "POST", body: "{not json" });
    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("parseJsonBody rejects a wrong shape and accepts a right one", async () => {
    const bad = new Request("https://x/api", {
      method: "POST",
      body: JSON.stringify({ displayName: "" }),
    });
    await expect(parseJsonBody(bad, schema)).rejects.toBeInstanceOf(ApiError);

    const good = new Request("https://x/api", {
      method: "POST",
      body: JSON.stringify({ displayName: "  Ada  " }),
    });
    await expect(parseJsonBody(good, schema)).resolves.toEqual({ displayName: "Ada" });
  });

  it("parseQuery coerces and validates search params", () => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1) });
    expect(parseQuery("https://x/api?page=3", q)).toEqual({ page: 3 });
    expect(parseQuery("https://x/api", q)).toEqual({ page: 1 });
    expect(() => parseQuery("https://x/api?page=0", q)).toThrow(ApiError);
    expect(() => parseQuery("https://x/api?page=abc", q)).toThrow(ApiError);
  });

  it("parseParams maps a malformed id to NOT_FOUND", () => {
    const p = z.object({ id: z.uuid() });
    expect(() => parseParams(p, { id: "not-a-uuid" })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    );
    const id = "6f1f0a7e-3f8c-4b2f-9f6a-1a2b3c4d5e6f";
    expect(parseParams(p, { id })).toEqual({ id });
  });
});

describe("CSRF origin check", () => {
  it("allows a missing Origin header", () => {
    expect(isOriginAllowed(null, APP_URL)).toBe(true);
    expect(isOriginAllowed(undefined, APP_URL)).toBe(true);
    expect(isOriginAllowed("", APP_URL)).toBe(true);
  });

  it("allows the APP_URL origin only", () => {
    expect(isOriginAllowed("https://app.example.com", APP_URL)).toBe(true);
    expect(isOriginAllowed("https://app.example.com", `${APP_URL}/some/path`)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", APP_URL)).toBe(false);
    expect(isOriginAllowed("http://app.example.com", APP_URL)).toBe(false);
    expect(isOriginAllowed("https://app.example.com:8443", APP_URL)).toBe(false);
    expect(isOriginAllowed("https://app.example.com.evil.com", APP_URL)).toBe(false);
    expect(isOriginAllowed("null", APP_URL)).toBe(false);
    expect(isOriginAllowed("garbage", APP_URL)).toBe(false);
  });

  it("assertOriginAllowed throws 403 FORBIDDEN for state-changing methods only", () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      const request = new Request("https://app.example.com/api/x", {
        method,
        headers: { origin: "https://evil.example.com" },
      });
      expect(() => assertOriginAllowed(request, APP_URL)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
      );
    }
    const get = new Request("https://app.example.com/api/x", {
      method: "GET",
      headers: { origin: "https://evil.example.com" },
    });
    expect(() => assertOriginAllowed(get, APP_URL)).not.toThrow();
    const same = new Request("https://app.example.com/api/x", {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    });
    expect(() => assertOriginAllowed(same, APP_URL)).not.toThrow();
  });
});

describe("withApi", () => {
  const context = { params: Promise.resolve({}) };

  it("passes through a handler response", async () => {
    const handler = withApi("t", async () => ok({ a: 1 }));
    const response = await handler(new Request("https://x/api"), context);
    expect(await response.json()).toEqual({ ok: true, data: { a: 1 } });
  });

  it("maps ApiError to its envelope", async () => {
    const handler = withApi("t", async () => {
      throw new ApiError("NOT_FOUND", "Gone");
    });
    const response = await handler(new Request("https://x/api"), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Gone" },
    });
  });

  it("maps unknown errors to a generic INTERNAL 500 without leaking the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withApi("t", async () => {
      throw new Error("token=ghs_secretvalue");
    });
    const response = await handler(new Request("https://x/api"), context);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("ghs_secretvalue");
    spy.mockRestore();
  });
});

describe("getClientIp", () => {
  it("uses the first X-Forwarded-For entry, then X-Real-IP, then unknown", () => {
    expect(
      getClientIp(new Request("https://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })),
    ).toBe("1.2.3.4");
    expect(getClientIp(new Request("https://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe(
      "5.6.7.8",
    );
    expect(getClientIp(new Request("https://x"))).toBe("unknown");
  });
});
