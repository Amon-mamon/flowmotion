// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dedupeSignals, extractSignals } from "@/lib/analysis/extractors";
import { extractCiWorkflows } from "@/lib/analysis/extractors/ci-workflow";
import { extractDbWrites } from "@/lib/analysis/extractors/db-write";
import { extractEnvVars } from "@/lib/analysis/extractors/env-var";
import { extractMessaging } from "@/lib/analysis/extractors/messaging";
import { extractQueueConsumers } from "@/lib/analysis/extractors/queue-consumer";
import { extractRoutes } from "@/lib/analysis/extractors/route";
import { extractSchedules } from "@/lib/analysis/extractors/schedule";
import { extractWebhooks } from "@/lib/analysis/extractors/webhook";
import type { Signal } from "@/schemas/analysis";

const labels = (signals: Signal[]) => signals.map((s) => s.label);

describe("route extractor", () => {
  it("Next app route exports", () => {
    const out = extractRoutes({
      path: "src/app/(shop)/api/orders/[id]/route.ts",
      text: "export async function GET() {}\nexport const POST = async () => {};\n",
    });
    expect(labels(out)).toEqual(["GET /api/orders/[id]", "POST /api/orders/[id]"]);
    expect(out[1]?.line).toBe(2);
  });
  it("Next pages api", () => {
    expect(labels(extractRoutes({ path: "pages/api/users/index.ts", text: "export default () => {}" }))).toEqual(["ANY /api/users"]);
  });
  it("Express / Fastify / Hono / Koa", () => {
    const text = "app.get('/health', h);\nrouter.post(\"/orders\", h);\nfastify.delete(`/x`, h);";
    expect(labels(extractRoutes({ path: "server.js", text }))).toEqual(["GET /health", "POST /orders", "DELETE /x"]);
  });
  it("Flask and FastAPI", () => {
    const text = "@app.route('/pay', methods=['POST', 'PUT'])\ndef pay(): pass\n@router.get('/items')\n";
    expect(labels(extractRoutes({ path: "app.py", text }))).toEqual(["POST,PUT /pay", "GET /items"]);
  });
  it("Django", () => {
    expect(labels(extractRoutes({ path: "urls.py", text: "path('orders/', views.orders)" }))).toEqual(["ANY /orders/"]);
  });
  it("Rails", () => {
    expect(labels(extractRoutes({ path: "config/routes.rb", text: "  post 'webhooks/stripe', to: 'x#y'" }))).toEqual(["POST /webhooks/stripe"]);
  });
  it("Laravel", () => {
    expect(labels(extractRoutes({ path: "routes/web.php", text: "Route::post('/checkout', [A::class, 'b']);" }))).toEqual(["POST /checkout"]);
  });
});

describe("webhook extractor", () => {
  it("routes with webhook in the path or label", () => {
    const out = extractWebhooks({ path: "src/app/api/webhooks/stripe/route.ts", text: "export async function POST() {}" });
    expect(out).toEqual([expect.objectContaining({ kind: "webhook", label: "POST /api/webhooks/stripe" })]);
  });
  it("stripe constructEvent, x-hub-signature, svix", () => {
    const text = "stripe.webhooks.constructEvent(body, sig, s);\nreq.headers['x-hub-signature-256'];\nimport { Webhook } from 'svix';";
    expect(labels(extractWebhooks({ path: "src/lib/hooks.ts", text }))).toEqual(["stripe", "github", "svix"]);
  });
  it("a webhook file without routes yields its file name", () => {
    expect(labels(extractWebhooks({ path: "src/webhook-handler.ts", text: "export {}" }))).toEqual(["webhook-handler.ts"]);
  });
});

describe("schedule extractor", () => {
  it("vercel.json crons", () => {
    const text = JSON.stringify({ crons: [{ path: "/api/cron", schedule: "0 3 * * *" }] });
    expect(labels(extractSchedules({ path: "vercel.json", text }))).toEqual(["0 3 * * *"]);
  });
  it("GitHub Actions on.schedule.cron", () => {
    const text = "on:\n  schedule:\n    - cron: '*/15 * * * *'\n";
    expect(labels(extractSchedules({ path: ".github/workflows/nightly.yml", text }))).toEqual(["*/15 * * * *"]);
  });
  it("node-cron, CronJob, Nest @Cron", () => {
    const text = "cron.schedule('0 * * * *', fn);\nnew CronJob('5 4 * * *', fn);\n@Cron(CronExpression.EVERY_HOUR)\n@Cron('0 0 * * 0')";
    expect(labels(extractSchedules({ path: "src/jobs.ts", text }))).toEqual([
      "0 * * * *",
      "5 4 * * *",
      "CronExpression.EVERY_HOUR",
      "0 0 * * 0",
    ]);
  });
  it("Celery beat and SQL cron.schedule", () => {
    expect(labels(extractSchedules({ path: "celery.py", text: "app.conf.beat_schedule = {}" }))).toEqual(["schedule"]);
    expect(labels(extractSchedules({ path: "db/cron.sql", text: "select cron.schedule('purge', '0 3 * * *', 'delete');" }))).toEqual(["0 3 * * *"]);
  });
  it("odd cron text falls back to 'schedule'", () => {
    expect(labels(extractSchedules({ path: "a.ts", text: "cron.schedule('<script>', fn)" }))).toEqual(["schedule"]);
  });
});

describe("queue consumer extractor", () => {
  it.each([
    ["worker.ts", "new Worker('emails', async () => {})", "BullMQ Worker"],
    ["a.processor.ts", "@Processor('audio')", "Nest Processor"],
    ["amqp.js", "channel.consume('jobs', onMessage)", "amqplib consume"],
    ["sqs.ts", "new ReceiveMessageCommand({})", "SQS ReceiveMessage"],
    ["tasks.py", "@shared_task\ndef x(): pass", "Celery task"],
    ["job.rb", "include Sidekiq::Worker", "Sidekiq"],
    ["Job.php", "class SendMail implements ShouldQueue", "Laravel ShouldQueue"],
    ["inngest.ts", "inngest.createFunction({ id: 'x' })", "Inngest function"],
    ["trigger.ts", "export const t = task({ id: 'x', run: async () => {} })", "Trigger.dev task"],
  ])("%s", (path, text, label) => {
    expect(labels(extractQueueConsumers({ path, text }))).toEqual([label]);
  });
  it("Python-only patterns do not fire in JS", () => {
    expect(extractQueueConsumers({ path: "a.ts", text: "@shared_task" })).toEqual([]);
  });
});

describe("messaging extractor", () => {
  it("JS imports", () => {
    const text = "import nodemailer from 'nodemailer';\nconst { WebClient } = require('@slack/web-api');\nimport { Resend } from \"resend\";";
    expect(labels(extractMessaging({ path: "a.ts", text }))).toEqual(["nodemailer", "@slack/web-api", "resend"]);
  });
  it("Python smtplib and slack_sdk", () => {
    expect(labels(extractMessaging({ path: "a.py", text: "import smtplib\nfrom slack_sdk import WebClient" }))).toEqual(["smtplib", "slack_sdk"]);
  });
  it("unknown libraries are ignored", () => {
    expect(extractMessaging({ path: "a.ts", text: "import x from 'left-pad'" })).toEqual([]);
  });
});

describe("db write extractor", () => {
  it("Supabase, Prisma, Drizzle, SQL", () => {
    const text = [
      "await supabase.from('orders').insert(row)",
      "await prisma.user.create({ data })",
      "await db.insert(invoices).values(x)",
      "INSERT INTO audit_log (a) VALUES (1)",
      "UPDATE accounts SET x = 1",
    ].join("\n");
    expect(labels(extractDbWrites({ path: "a.ts", text }))).toEqual(["orders", "user", "invoices", "audit_log", "accounts"]);
  });
  it("Django and ActiveRecord", () => {
    expect(labels(extractDbWrites({ path: "v.py", text: "Order.objects.create(x=1)" }))).toEqual(["Order"]);
    expect(labels(extractDbWrites({ path: "c.rb", text: "User.create!(name: n)" }))).toEqual(["User"]);
  });
});

describe("ci workflow extractor", () => {
  it("label is the workflow name or the file name", () => {
    expect(labels(extractCiWorkflows({ path: ".github/workflows/ci.yml", text: "name: CI build\non: push" }))).toEqual(["CI build"]);
    expect(labels(extractCiWorkflows({ path: ".github/workflows/deploy.yaml", text: "on: push" }))).toEqual(["deploy.yaml"]);
    expect(extractCiWorkflows({ path: "ci.yml", text: "name: x" })).toEqual([]);
  });
});

describe("env var extractor (names only)", () => {
  it("every pattern", () => {
    const text = [
      "process.env.STRIPE_KEY",
      'process.env["DATABASE_URL"]',
      "import.meta.env.VITE_API_URL",
      "os.environ['SECRET_KEY']",
      "os.environ.get('DEBUG_MODE')",
      "os.getenv('REDIS_URL')",
      "ENV['RAILS_KEY']",
      "ENV.fetch('SMTP_HOST')",
      "env('APP_KEY')",
      "process.env.lowercase",
    ].join("\n");
    expect(labels(extractEnvVars({ path: "a.ts", text }))).toEqual([
      "STRIPE_KEY",
      "DATABASE_URL",
      "VITE_API_URL",
      "SECRET_KEY",
      "DEBUG_MODE",
      "REDIS_URL",
      "RAILS_KEY",
      "SMTP_HOST",
      "APP_KEY",
    ]);
  });
  it(".env.example keys, never values", () => {
    const out = extractEnvVars({ path: ".env.example", text: "export API_KEY=[REDACTED]\nAPP_URL=http://localhost\n# COMMENT=x" });
    expect(labels(out)).toEqual(["API_KEY", "APP_URL"]);
    expect(JSON.stringify(out)).not.toContain("localhost");
  });
});

describe("signal dedupe and caps", () => {
  it("dedupes on (kind, filePath, label) and env vars by name across files", () => {
    const s = (kind: Signal["kind"], filePath: string, label: string): Signal => ({ kind, filePath, line: 1, label });
    const out = dedupeSignals([
      s("route", "a.ts", "GET /x"),
      s("route", "a.ts", "GET /x"),
      s("route", "b.ts", "GET /x"),
      s("env_var", "a.ts", "API_KEY"),
      s("env_var", "b.ts", "API_KEY"),
    ]);
    expect(out).toHaveLength(3);
  });
  it("caps at 500", () => {
    const many = Array.from({ length: 600 }, (_, i): Signal => ({ kind: "route", filePath: "a.ts", line: 1, label: `GET /${i}` }));
    expect(dedupeSignals(many)).toHaveLength(500);
  });
  it("labels are plain text, max 120 chars", () => {
    const out = extractSignals({ path: "a.ts", text: `app.get('/${"x".repeat(300)}', h)` });
    expect(out[0]?.label.length).toBe(120);
  });
});
