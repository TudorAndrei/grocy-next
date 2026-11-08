import { createFileRoute } from "@tanstack/react-router";
import { StockSettings } from "@/components/StockSettings";

export const Route = createFileRoute("/stocksettings")({ component: StockSettings });
