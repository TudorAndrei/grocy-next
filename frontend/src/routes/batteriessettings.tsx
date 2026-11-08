import { createFileRoute } from "@tanstack/react-router";
import { HouseholdSettings } from "@/components/HouseholdSettings";

export const Route = createFileRoute("/batteriessettings")({ component: Page });

function Page() {
  return <HouseholdSettings kind="batteries" />;
}
