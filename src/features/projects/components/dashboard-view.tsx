"use client";

import { WorkflowIcon } from "lucide-react";
import { Suspense } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { AddRepositoryDialog } from "@/features/projects/components/add-repository-dialog";
import { DashboardNotices } from "@/features/projects/components/dashboard-notices";
import { ProjectsGrid } from "@/features/projects/components/projects-grid";

export function DashboardView() {
  return (
    <>
      <Suspense fallback={null}>
        <DashboardNotices />
      </Suspense>

      <PageHeader
        title="Dashboard"
        description="Repositories connected to Flow Motion."
        actions={<AddRepositoryDialog />}
      />

      <section aria-labelledby="projects-heading" className="flex flex-col gap-4">
        <h2 id="projects-heading" className="text-lg font-semibold">
          Projects
        </h2>
        <ProjectsGrid />
      </section>

      <section aria-labelledby="flows-heading" className="flex flex-col gap-4">
        <h2 id="flows-heading" className="text-lg font-semibold">
          Recent flows
        </h2>
        <EmptyState
          icon={<WorkflowIcon />}
          title="No flows yet"
          description="Generated flows will appear here once a project has been analyzed."
        />
      </section>
    </>
  );
}
