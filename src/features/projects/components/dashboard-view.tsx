"use client";

import { Suspense } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { RecentFlows, RecentFlowsEmpty } from "@/features/flows/components/recent-flows";
import { isGenerateApiReady } from "@/features/flows/readiness";
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
        {/* One gate for both 3b APIs (D-59): no request to /api/flows until OC-8. */}
        {isGenerateApiReady() ? <RecentFlows /> : <RecentFlowsEmpty />}
      </section>
    </>
  );
}
