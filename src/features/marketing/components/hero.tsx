import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="py-24 sm:py-32">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-8">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          From repository to n8n workflow
        </p>
        <h1
          id="hero-heading"
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl"
        >
          Find the automations hiding in your codebase. Export them as n8n flows.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Flow Motion connects to a GitHub repository with read-only access, reads only safe
          files, recommends automations, builds each one from an allowed set of n8n nodes,
          simulates it with mock data, and gives you an importable JSON file. It never runs
          flows for you.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>
            Get started
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Link
            href="#how-it-works"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See how it works
          </Link>
        </div>
        <dl className="grid max-w-3xl grid-cols-1 gap-4 border-t border-border pt-8 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Access</dt>
            <dd className="font-medium">Read-only GitHub App</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Source code stored</dt>
            <dd className="font-medium">None</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Output</dt>
            <dd className="font-medium">n8n JSON plus setup checklist</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
