// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  MAX_FILE_BYTES,
  classifyPath,
  isDeniedPath,
  normalizeRepoPath,
} from "@/lib/security/path-policy";
import { scan } from "@/lib/security/secret-scanner";

const denied = (path: string) => expect(classifyPath(path, 10), path).toEqual({ allowed: false, reason: "denied" });
const allowed = (path: string) => expect(classifyPath(path, 10), path).toEqual({ allowed: true });

describe("path policy: deny list (security.md section 1)", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.development.local",
    "key.pem",
    "certs/server.key",
    "cert.p12",
    "cert.pfx",
    "app.jks",
    "release.keystore",
    "id_rsa",
    "id_rsa.pub",
    "home/id_ed25519",
    "putty.ppk",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    ".aws/config",
    ".ssh/known_hosts",
    ".gcloud/settings.json",
    ".kube/config",
    ".docker/config.json",
    "src/credentials.ts",
    "credentialsForm.tsx",
    "src/secret.ts",
    "lib/secrets-manager-client.ts",
    "config/secrets.yml",
    "service-account.json",
    "service-account-prod.json",
    "infra/terraform.tfstate",
    "infra/terraform.tfstate.backup",
    "terraform.tfvars",
    "prod.tfvars",
    "data/app.sqlite",
    "local.db",
    "backup.dump",
    ".git/config",
    "node_modules/react/index.js",
  ])("denies %s", (path) => denied(path));

  it.each([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Gemfile.lock",
    "composer.lock",
    "poetry.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "go.sum",
    "web/package-lock.json",
  ])("denies lockfile %s", (path) => denied(path));

  it.each([
    "dist/index.js",
    "build/main.js",
    "out/page.html",
    ".next/server/app.js",
    ".nuxt/app.js",
    ".svelte-kit/output.js",
    "coverage/lcov.json",
    "vendor/autoload.php",
    "target/classes/App.java",
    "__pycache__/x.py",
    ".venv/lib/site.py",
    "venv/lib/site.py",
    "public/app.min.js",
    "public/app.js.map",
  ])("denies build or vendor output %s", (path) => denied(path));

  it("matches every path segment, so a denied directory denies its contents", () => {
    denied("config/secrets/db.ts");
    denied("packages/api/.aws/credentials");
    denied("apps/web/node_modules/x/index.ts");
    denied("a/b/.env/thing.ts");
  });

  it("is case-insensitive", () => {
    denied(".ENV");
    denied(".Env.Local");
    denied("KEY.PEM");
    denied("SRC/SECRET.TS");
    denied("Node_Modules/x.js");
    denied("Package-Lock.json");
  });
});

describe("path policy: normalisation and traversal", () => {
  it("normalises separators, ./ and ..", () => {
    expect(normalizeRepoPath("./src/app.ts")).toBe("src/app.ts");
    expect(normalizeRepoPath("src\\api\\route.ts")).toBe("src/api/route.ts");
    expect(normalizeRepoPath("a/./b/../c.ts")).toBe("a/c.ts");
    expect(normalizeRepoPath("/abs/x.ts")).toBe("abs/x.ts");
  });

  it("a path escaping the root is denied", () => {
    expect(normalizeRepoPath("../x.ts")).toBeNull();
    denied("../x.ts");
    denied("a/../../x.ts");
    denied("");
  });

  it("required tricky cases", () => {
    denied("./.env");
    denied("a/../.env");
    denied("sub\\.env");
    denied("sub\\dir\\.env.local");
    denied("src/../.env.production");
    expect(isDeniedPath("./.env")).toBe(true);
  });
});

describe("path policy: .env.example exception", () => {
  it("allows the exact basename at the root and in a subdirectory", () => {
    allowed(".env.example");
    allowed("apps/web/.env.example");
    allowed("./.env.example");
  });

  it.each([".env.example.bak", ".env.sample", ".env.example.local", ".ENV.EXAMPLE", ".Env.Example", "env.example"])(
    "does not extend to %s",
    (path) => {
      const decision = classifyPath(path, 10);
      expect(decision.allowed, path).toBe(false);
    },
  );

  it("env.example (no leading dot) is not an env file but is not the exception either", () => {
    expect(classifyPath("env.example", 10)).toEqual({ allowed: false, reason: "extension" });
  });

  it("the exception does not open a denied directory", () => {
    denied("secrets/.env.example");
    denied("node_modules/pkg/.env.example");
  });

  it(".env.example content still goes through the secret scanner", () => {
    const path = ".env.example";
    expect(classifyPath(path, 100).allowed).toBe(true);
    const text = "STRIPE_KEY=sk_live_abcdefghijklmnop1234\nAPP_URL=http://localhost:3000\n";
    const result = scan(path, text);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe("hardcoded_secret");
    expect(result.redacted).not.toContain("sk_live_abcdefghijklmnop1234");
  });
});

describe("path policy: extension allowlist and size cap", () => {
  it.each([
    "src/app.ts",
    "src/App.tsx",
    "index.js",
    "a.jsx",
    "a.mjs",
    "a.cjs",
    "App.vue",
    "App.svelte",
    "page.astro",
    "app.py",
    "app.rb",
    "index.php",
    "main.go",
    "App.java",
    "Main.kt",
    "Program.cs",
    "main.dart",
    "package.json",
    "ci.yml",
    "docker-compose.yaml",
    "netlify.toml",
    "schema.prisma",
    "001.sql",
    "schema.graphql",
    "q.gql",
    "index.html",
    "README.md",
    "Dockerfile",
    "Procfile",
    "Gemfile",
    "Web.csproj",
    "SRC/APP.TS",
  ])("allows %s", (path) => allowed(path));

  it.each(["logo.png", "video.mp4", "archive.zip", "styles.css", "notes.txt", "Makefile", "requirements.txt", "dockerfile"])(
    "%s → extension",
    (path) => expect(classifyPath(path, 10)).toEqual({ allowed: false, reason: "extension" }),
  );

  it("size cap is 200 KB (> 204800 → size)", () => {
    expect(classifyPath("src/a.ts", MAX_FILE_BYTES)).toEqual({ allowed: true });
    expect(classifyPath("src/a.ts", MAX_FILE_BYTES + 1)).toEqual({ allowed: false, reason: "size" });
  });

  it("order: deny before extension before size", () => {
    expect(classifyPath(".env", MAX_FILE_BYTES + 1)).toEqual({ allowed: false, reason: "denied" });
    expect(classifyPath("logo.png", MAX_FILE_BYTES + 1)).toEqual({ allowed: false, reason: "extension" });
  });
});
