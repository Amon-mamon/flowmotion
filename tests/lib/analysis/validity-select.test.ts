// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MAX_SELECTED_FILES, blockedTotal, selectFiles, tierOf } from "@/lib/analysis/select";
import { INVALID_REASONS, checkValidity, pickManifestPaths } from "@/lib/analysis/validity";

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: "x", dependencies: deps, devDependencies: dev });

function check(paths: string[], manifests: Record<string, string> = {}) {
  return checkValidity(paths, new Map(Object.entries(manifests)));
}

describe("validity: markers", () => {
  const src = ["src/index.ts"];
  it.each([
    ["next", "website"],
    ["react", "website"],
    ["react-dom", "website"],
    ["vue", "website"],
    ["svelte", "website"],
    ["@sveltejs/kit", "website"],
    ["nuxt", "website"],
    ["astro", "website"],
    ["@angular/core", "website"],
    ["@remix-run/node", "website"],
    ["react-native", "app"],
    ["expo", "app"],
    ["express", "app"],
    ["fastify", "app"],
    ["@nestjs/core", "app"],
    ["hono", "app"],
    ["koa", "app"],
  ])("package.json with %s → %s", (dep, kind) => {
    expect(check([...src, "package.json"], { "package.json": pkg({ [dep]: "1" }) })).toEqual({ kind, reason: null });
  });

  it("devDependencies count too", () => {
    expect(check([...src, "package.json"], { "package.json": pkg({}, { vue: "3" }) }).kind).toBe("website");
  });

  it("server framework plus a website marker → website", () => {
    expect(check([...src, "package.json"], { "package.json": pkg({ express: "4", react: "18" }) }).kind).toBe("website");
  });

  it.each([
    ["requirements.txt", "Django==5.0\n", "website"],
    ["requirements.txt", "flask>=3\n", "app"],
    ["pyproject.toml", 'dependencies = ["fastapi>=0.110"]\n', "app"],
    ["Gemfile", "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n", "website"],
    ["composer.json", JSON.stringify({ require: { "laravel/framework": "^11" } }), "website"],
    ["pubspec.yaml", "name: app\nflutter:\n  uses-material-design: true\n", "app"],
    ["go.mod", "module x\nrequire github.com/gin-gonic/gin v1.9.1\n", "app"],
    ["go.mod", "module x\nrequire github.com/go-chi/chi v5\n", "app"],
    ["pom.xml", "<artifactId>spring-boot-starter-web</artifactId>", "app"],
    ["build.gradle", "id 'org.springframework.boot' version '3'\nimplementation 'org.springframework.boot:spring-boot-starter'", "app"],
    ["Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web">', "app"],
  ])("%s marker → %s", (file, text, kind) => {
    expect(check(["main.py", "app.go", file], { [file]: text })).toEqual({ kind, reason: null });
  });

  it("index.html with assets → website", () => {
    expect(check(["index.html", "app.js"])).toEqual({ kind: "website", reason: null });
    expect(check(["public/index.html", "public/style.css"]).kind).toBe("website");
    expect(check(["src/index.html", "src/main.js"]).kind).toBe("website");
  });

  it("manifest text that is not JSON does not crash", () => {
    expect(check(["src/a.ts", "package.json"], { "package.json": "{not json" }).reason).toBe(INVALID_REASONS.noFramework);
  });
});

describe("validity: invalid reasons (exact strings)", () => {
  it("empty", () => expect(check([])).toEqual({ kind: "invalid", reason: "The repository is empty." }));
  it("docs only", () =>
    expect(check(["README.md", "docs/guide.md", "notes.txt", "LICENSE"])).toEqual({
      kind: "invalid",
      reason: "The repository only contains documentation.",
    }));
  it("dotfiles / data only → no source", () => {
    expect(check([".gitignore", ".editorconfig", "data.json", "config.yml"]).reason).toBe("No source code was found.");
  });
  it("source but no framework", () => {
    expect(check(["script.py"]).reason).toBe(
      "No website or app framework was found. Flow Motion supports web and mobile app projects.",
    );
    expect(check(["index.html"]).reason).toBe(INVALID_REASONS.noFramework);
  });
});

describe("validity: pickManifestPaths", () => {
  it("depth ≤ 3, not denied, shallowest first, at most 15", () => {
    const entries = [
      { path: "a/b/c/d/package.json", size: 10 },
      { path: "node_modules/x/package.json", size: 10 },
      { path: "apps/web/package.json", size: 10 },
      { path: "package.json", size: 10 },
      { path: "requirements.txt", size: 10 },
      { path: "big/package.json", size: 300_000 },
      ...Array.from({ length: 20 }, (_, i) => ({ path: `pkgs/p${i}/package.json`, size: 10 })),
    ];
    const picked = pickManifestPaths(entries);
    expect(picked.length).toBe(15);
    expect(picked.slice(0, 2)).toEqual(["package.json", "requirements.txt"]);
    expect(picked).not.toContain("a/b/c/d/package.json");
    expect(picked).not.toContain("node_modules/x/package.json");
    expect(picked).not.toContain("big/package.json");
  });
});

describe("selection", () => {
  const blob = (path: string, size = 100) => ({ path, sha: "a".repeat(40), size });

  it("tiers", () => {
    expect(tierOf("package.json")).toBe(1);
    expect(tierOf("apps/web/.env.example")).toBe(1);
    expect(tierOf(".github/workflows/ci.yml")).toBe(2);
    expect(tierOf("vercel.json")).toBe(2);
    expect(tierOf("Dockerfile")).toBe(2);
    expect(tierOf("docker-compose.prod.yml")).toBe(2);
    expect(tierOf("supabase/functions/hook/index.ts")).toBe(2);
    expect(tierOf("src/app/api/orders/route.ts")).toBe(3);
    expect(tierOf("pages/api/hello.ts")).toBe(3);
    expect(tierOf("app/urls.py")).toBe(3);
    expect(tierOf("src/webhooks.ts")).toBe(3);
    expect(tierOf("prisma/schema.prisma")).toBe(4);
    expect(tierOf("db/migrations/001.sql")).toBe(4);
    expect(tierOf("app/models/user.rb")).toBe(4);
    expect(tierOf("README.md")).toBe(5);
    expect(tierOf("src/lib/util.ts")).toBe(6);
  });

  it("orders by tier, then depth, then path; counts every reason", () => {
    const blobs = [
      blob("src/lib/util.ts"),
      blob("README.md"),
      blob("src/app/api/b/route.ts"),
      blob("src/app/api/a/route.ts"),
      blob("package.json"),
      blob(".env"),
      blob("logo.png"),
      blob("big.ts", 300_000),
      blob(".github/workflows/ci.yml"),
    ];
    const result = selectFiles(blobs);
    expect(result.selected.map((b) => b.path)).toEqual([
      "package.json",
      ".github/workflows/ci.yml",
      "src/app/api/a/route.ts",
      "src/app/api/b/route.ts",
      "README.md",
      "src/lib/util.ts",
    ]);
    expect(result.counts).toEqual({ considered: 9, denied: 1, extension: 1, size: 1, cap: 0 });
    expect(result.deniedPaths).toEqual([".env"]);
    expect(blockedTotal(result.counts)).toBe(3);
  });

  it("is deterministic regardless of input order", () => {
    const blobs = Array.from({ length: 50 }, (_, i) => blob(`src/f${i}.ts`));
    const a = selectFiles(blobs).selected.map((b) => b.path);
    const b = selectFiles([...blobs].reverse()).selected.map((x) => x.path);
    expect(a).toEqual(b);
  });

  it("keeps the first 400 and counts the rest as cap", () => {
    const blobs = Array.from({ length: 450 }, (_, i) => blob(`src/f${String(i).padStart(3, "0")}.ts`));
    const result = selectFiles(blobs);
    expect(result.selected).toHaveLength(MAX_SELECTED_FILES);
    expect(result.counts.cap).toBe(50);
    expect(blockedTotal(result.counts)).toBe(50);
  });
});
