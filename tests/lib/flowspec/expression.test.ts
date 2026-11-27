// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseExpression, parseTemplate } from "@/lib/flowspec/expression";
import {
  conditionSchema,
  fieldPathSchema,
  identSchema,
  pairSchema,
  placeholderSchema,
  textSchema,
  valueSchema,
} from "@/lib/flowspec/values";

const accepts = (source: string) => expect(parseExpression(source).ok, source).toBe(true);
const rejects = (source: string) => expect(parseExpression(source).ok, source).toBe(false);

describe("expression subset (contract section 7): accepted productions", () => {
  it.each([
    ["$json with a dot path", " $json.name "],
    ["nested dot path", "$json.order.customer.name"],
    ["bracket string, double quotes", '$json["first name"]'],
    ["bracket string, single quotes", "$json['first name']"],
    ["bracket integer", "$json.items[0]"],
    ["mixed path of six segments", '$json.a["b"][2].c.d.e'],
    ["$node reference", '$node["Shape Order"].json.total'],
    ["$node reference, single quotes", "$node['Shape Order'].json[\"total\"]"],
    ["string operand in a comparison", '$json.s == "paid"'],
    ["single-quoted string operand", "$json.s == 'paid'"],
    ["number operand", "$json.n == 42"],
    ["negative decimal operand", "$json.n > -3.25"],
    ["true", "$json.b == true"],
    ["false", "$json.b == false"],
    ["null", "$json.a == null"],
    ["literal on the left of a comparison", "'paid' == $json.s"],
    ["==", '$json.status == "paid"'],
    ["!=", "$json.status != 'open'"],
    [">", "$json.total > 100"],
    [">=", "$json.total >= 100"],
    ["<", "$json.total < $json.limit"],
    ["<=", '$node["A"].json.n <= 5'],
    ["comparison without spaces", "$json.a==null"],
    ["a line break as whitespace", "\n$json.a\n"],
  ])("%s", (_label, source) => accepts(source));

  it("reports $node references", () => {
    const parsed = parseExpression('$node["A"].json.x == $node["B c"].json.y');
    expect(parsed).toEqual({ ok: true, nodeRefs: ["A", "B c"] });
  });
});

describe("expression subset: rejected", () => {
  it.each([
    ["function call", "$json.name.toUpperCase()"],
    ["call on a ref", "$json.a()"],
    ["global call", "fetch('x')"],
    ["constructor escape", "$json.a.constructor()"],
    ["constructor property", "$json.constructor"],
    ["__proto__ property", "$json.__proto__"],
    ["prototype by bracket", '$json["prototype"]'],
    ["$env", "$env.SECRET"],
    ["$execution", "$execution.id"],
    ["$workflow", "$workflow.name"],
    ["$vars", "$vars.token"],
    ["$secrets", "$secrets.vault.key"],
    ["$node without .json", '$node["A"].data.x'],
    ["$node with an unquoted name", "$node[A].json.x"],
    ["bare $json", "$json"],
    ["arithmetic +", "$json.a + 1"],
    ["arithmetic *", "2 * 3"],
    ["string concatenation", '"a" + "b"'],
    ["two comparisons", "$json.a == 1 == true"],
    ["logical and", "$json.a && $json.b"],
    ["ternary", "$json.a ? 1 : 2"],
    ["negation", "!$json.a"],
    ["assignment", "$json.a = 1"],
    ["strict equality", "$json.a === 1"],
    ["template literal", "`x`"],
    ["object literal", "{ a: 1 }"],
    ["array literal", "[1, 2]"],
    ["identifier", "process"],
    ["seven path segments", "$json.a.b.c.d.e.f.g"],
    ["string with a backslash", '"a\\"b"'],
    ["string with a line break", '"a\nb"'],
    ["string with the other quote", `"it's"`],
    ["string longer than 100 chars", `"${"a".repeat(101)}"`],
    ["field name longer than 64 chars", `$json.${"a".repeat(65)}`],
    ["empty", ""],
    ["semicolon", "$json.a; $json.b"],
    ["comment", "$json.a /* x */"],
    ["optional chaining", "$json?.a"],
    ["operand glued to an identifier", "true1"],
  ])("%s", (_label, source) => rejects(source));

  it("accepts a 100-char string and a 64-char field name (the limits)", () => {
    accepts(`$json.s == "${"a".repeat(100)}"`);
    accepts(`$json.${"a".repeat(64)}`);
  });
});

describe("S3aR-2: a lone literal is never a whole expression", () => {
  it.each(['"paid"', "'//'", "42", "-3.25", "true", "false", "null", " '/' "])("%s", (source) => rejects(source));
});

describe("templates", () => {
  it("text without braces is a literal", () => {
    expect(parseTemplate("Hello <b>world</b> { single }")).toMatchObject({ ok: true, hasExpression: false });
  });

  it("splits literals and expressions", () => {
    const parsed = parseTemplate("Order {{ $json.id }} for {{ $json.total }}!");
    expect(parsed).toMatchObject({ ok: true, hasExpression: true });
    if (parsed.ok) {
      expect(parsed.segments.map((segment) => segment.text)).toEqual([
        "Order ",
        "{{ $json.id }}",
        " for ",
        "{{ $json.total }}",
        "!",
      ]);
    }
  });

  it.each([
    ["nested {{", "{{ {{ $json.a }} }}"],
    ["nested {{ inside a string", '{{ "{{" }}'],
    ["unbalanced {{", "Hello {{ $json.a"],
    ["unbalanced }}", "Hello $json.a }}"],
    ["}} before {{", "}} {{ $json.a }}"],
    ["trailing }}", "{{ $json.a }} }}"],
    ["empty expression", "{{ }}"],
    ["invalid expression", "{{ $env.SECRET }}"],
    ["one invalid among valid", "{{ $json.a }} {{ $json.a.toString() }}"],
  ])("rejects %s", (_label, text) => {
    expect(parseTemplate(text).ok, text).toBe(false);
  });

  it("parses a 200 KB adversarial string in well under a second", () => {
    const size = 200 * 1024;
    const inputs = [
      "{{".repeat(size / 2),
      "}}".repeat(size / 2),
      "{".repeat(size),
      `{{ ${"$json".repeat(size / 5)} }}`,
      `{{ $json${".a".repeat(size / 2)} }}`,
      `{{ $json${"[0]".repeat(size / 3)} }}`,
      `{{ "${"a".repeat(size)}" }}`,
      `{{ ${" ".repeat(size)}$json.a }}`,
      `{{ ${"1".repeat(size)} }}`,
      "{{ $json.a }}".repeat(Math.floor(size / 13)),
      `${"{{ $json.a ".repeat(Math.floor(size / 12))}}}`,
      `{{ $json.a == ${'"'.repeat(size)} }}`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      parseTemplate(input);
      expect(performance.now() - started, `${input.slice(0, 24)}…`).toBeLessThan(250);
    }
    // The one well-formed input in the list still parses.
    expect(parseTemplate("{{ $json.a }}".repeat(1000)).ok).toBe(true);
  });
});

describe("value types (D-39)", () => {
  it("Text: literal, expression, and line breaks pass", () => {
    for (const text of ["", "Hello", "Total: {{ $json.total }}", "line one\nline two", "<script>alert(1)</script>", "a = b"]) {
      expect(textSchema.safeParse(text).success, text).toBe(true);
    }
  });

  it.each([
    ["a leading =", "={{ $json.a }}"],
    ["a leading = without braces", "=1+1"],
    ["a tab", "a\tb"],
    ["a NUL", "a\u0000b"],
    ["a carriage return", "a\r\nb"],
    ["more than 2,000 chars", "a".repeat(2001)],
    ["an invalid expression", "{{ $env.A }}"],
    ["an unbalanced brace pair", "{{ $json.a"],
    ["a plain-http URL", "see http://example.com"],
    ["a plain-http URL in capitals", "see HTTP://example.com"],
  ])("Text rejects %s", (_label, text) => {
    expect(textSchema.safeParse(text).success).toBe(false);
  });

  it("Value is Text, a finite number, or a boolean", () => {
    for (const value of ["x", 1, -2.5, true, false]) expect(valueSchema.safeParse(value).success).toBe(true);
    for (const value of [null, [], {}, Number.NaN, Number.POSITIVE_INFINITY, "=x"]) {
      expect(valueSchema.safeParse(value).success).toBe(false);
    }
  });

  it("Placeholder, FieldPath, Ident", () => {
    for (const value of ["YOUR_APP_URL", "YOUR_SLACK_CHANNEL_2", "YOUR_ID"]) {
      expect(placeholderSchema.safeParse(value).success, value).toBe(true);
    }
    for (const value of ["YOUR_", "YOUR_a", "your_app_url", "MY_APP_URL", "YOUR_APP_URL ", `YOUR_${"A".repeat(41)}`, "ops@example.com"]) {
      expect(placeholderSchema.safeParse(value).success, value).toBe(false);
    }
    for (const value of ["a", "a.b.c.d.e.f", "_private.field_1"]) expect(fieldPathSchema.safeParse(value).success).toBe(true);
    for (const value of ["", "a.b.c.d.e.f.g", "a..b", "a b", "1a", "a.", "a[0]"]) {
      expect(fieldPathSchema.safeParse(value).success, value).toBe(false);
    }
    for (const value of ["orders", "_t1"]) expect(identSchema.safeParse(value).success).toBe(true);
    for (const value of ["Orders", "public.orders", "orders;", "1t", 'o"', "a".repeat(64)]) {
      expect(identSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("Pair and Condition are strict; right is required for binary operators", () => {
    expect(pairSchema.safeParse({ name: "a", value: 1 }).success).toBe(true);
    expect(pairSchema.safeParse({ name: "a-b", value: 1 }).success).toBe(false);
    expect(pairSchema.safeParse({ name: "a", value: 1, extra: true }).success).toBe(false);
    expect(conditionSchema.safeParse({ left: "{{ $json.a }}", op: "equals", right: "x" }).success).toBe(true);
    expect(conditionSchema.safeParse({ left: "{{ $json.a }}", op: "equals" }).success).toBe(false);
    expect(conditionSchema.safeParse({ left: "{{ $json.a }}", op: "exists" }).success).toBe(true);
    expect(conditionSchema.safeParse({ left: "{{ $json.a }}", op: "matches", right: "x" }).success).toBe(false);
  });
});
