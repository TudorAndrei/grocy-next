import { createFileRoute } from "@tanstack/react-router";
import { HouseholdSettings } from "@/components/HouseholdSettings";

export const Route = createFileRoute("/choressettings")({ component: Page });

function Page() {
  return <HouseholdSettings kind="chores" />;
}
