import { createFileRoute } from "@tanstack/react-router";
import { HouseholdTracking } from "@/components/HouseholdTracking";

export const Route = createFileRoute("/choretracking")({
  component: () => <HouseholdTracking kind="chore" />,
});
