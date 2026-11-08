import { createFileRoute } from "@tanstack/react-router";
import { HouseholdTracking } from "@/components/HouseholdTracking";

export const Route = createFileRoute("/batterytracking")({
  component: () => <HouseholdTracking kind="battery" />,
});
