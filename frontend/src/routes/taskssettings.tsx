import { createFileRoute } from "@tanstack/react-router";
import { HouseholdSettings } from "@/components/HouseholdSettings";

export const Route = createFileRoute("/taskssettings")({ component: Page });

function Page() {
  return <HouseholdSettings kind="tasks" />;
}
