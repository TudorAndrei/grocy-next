import { createFileRoute } from "@tanstack/react-router";
import { StockOverviewPage } from "@/components/StockOverviewPage";

export const Route = createFileRoute("/stockoverview")({ component: StockOverviewPage });
