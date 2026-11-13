import { collect, extension, notNull, signal, type ExtractorFile } from "@/lib/analysis/extractors/util";
import type { Signal } from "@/schemas/analysis";

/**
 * `route` signals: Next.js app and pages routes, Express/Fastify/Hono/Koa,
 * Flask, FastAPI, Django, Rails, Laravel. Label `"<METHOD> <path>"`.
 */

/** URL path of a Next.js `app/.../route.*` file, or null. */
export function nextAppRoutePath(path: string): string | null {
  const match = /(?:^|\/)app\/((?:.*\/)?)route\.(?:ts|tsx|js|jsx|mjs)$/.exec(path);
  if (match === null) return null;
  const dir = (match[1] ?? "")
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
  return `/${dir.join("/")}`;
}

/** URL path of a Next.js `pages/api/...` file, or null. */
export function nextPagesApiPath(path: string): string | null {
  const match = /(?:^|\/)pages\/(api\/.+)\.(?:ts|tsx|js|jsx|mjs)$/.exec(path);
  if (match === null || match[1] === undefined) return null;
  return `/${match[1].replace(/\/index$/, "")}`;
}

function withSlash(route: string): string {
  return route.startsWith("/") ? route : `/${route}`;
}

export function extractRoutes(file: ExtractorFile): Signal[] {
  const out: (Signal | null)[] = [];
  const { path, text } = file;
  const ext = extension(path);

  const appRoute = nextAppRoutePath(path);
  if (appRoute !== null) {
    out.push(
      ...collect(
        /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g,
        text,
        (m) => signal("route", file, m.index, `${m[1] ?? ""} ${appRoute}`),
      ),
    );
  }

  const pagesApi = nextPagesApiPath(path);
  if (pagesApi !== null) out.push(signal("route", file, null, `ANY ${pagesApi}`));

  if (ext !== ".py" && ext !== ".rb" && ext !== ".php") {
    // Express / Fastify / Hono / Koa: app.get('/x', ...), router.post("/y", ...)
    out.push(
      ...collect(
        /\b(?:app|router|server|fastify|api|routes)\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`\s]*)\2/g,
        text,
        (m) => signal("route", file, m.index, `${(m[1] ?? "").toUpperCase()} ${m[3] ?? ""}`),
      ),
    );
  }

  if (ext === ".py") {
    // Flask: @app.route('/x', methods=['POST'])
    out.push(
      ...collect(/@\w+\.route\(\s*(['"])([^'"]+)\1([^)]*)\)/g, text, (m) => {
        const methods = /methods\s*=\s*\[([^\]]*)\]/.exec(m[3] ?? "");
        const list = (methods?.[1] ?? "")
          .split(",")
          .map((item) => item.replace(/['"\s]/g, "").toUpperCase())
          .filter((item) => item !== "");
        return signal("route", file, m.index, `${list.length > 0 ? list.join(",") : "GET"} ${m[2] ?? ""}`);
      }),
    );
    // FastAPI: @app.get('/x'), @router.post('/y')
    out.push(
      ...collect(/@\w+\.(get|post|put|patch|delete)\(\s*(['"])([^'"]+)\2/g, text, (m) =>
        signal("route", file, m.index, `${(m[1] ?? "").toUpperCase()} ${m[3] ?? ""}`),
      ),
    );
    // Django: path('x/', view), re_path(r'^x/$', view)
    out.push(
      ...collect(/\b(?:re_)?path\(\s*r?(['"])([^'"]*)\1/g, text, (m) =>
        signal(
          "route",
          file,
          m.index,
          `ANY /${(m[2] ?? "").replace(/^\^?\/?/, "").replace(/\$$/, "")}`,
        ),
      ),
    );
  }

  if (ext === ".rb") {
    // Rails: get '/x', to: ...
    out.push(
      ...collect(/^\s*(get|post|put|patch|delete)\s+(['"])([^'"]+)\2/gm, text, (m) =>
        signal("route", file, m.index, `${(m[1] ?? "").toUpperCase()} ${withSlash(m[3] ?? "")}`),
      ),
    );
  }

  if (ext === ".php") {
    // Laravel: Route::post('/x', ...)
    out.push(
      ...collect(/Route::(get|post|put|patch|delete|any)\(\s*(['"])([^'"]+)\2/g, text, (m) =>
        signal("route", file, m.index, `${(m[1] ?? "").toUpperCase()} ${withSlash(m[3] ?? "")}`),
      ),
    );
  }

  return out.filter(notNull);
}
