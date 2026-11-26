import type { Metadata } from "next";

import { IntegrationsView } from "@/features/integrations/components/integrations-view";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
