import { createFileRoute } from "@tanstack/react-router";
import { BatteriesOverview } from "@/components/BatteriesOverview";

export const Route = createFileRoute("/batteriesoverview")({ component: BatteriesOverview });
