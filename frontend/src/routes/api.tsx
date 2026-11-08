import { createFileRoute } from "@tanstack/react-router";
import { ApiBrowser } from "@/components/ApiBrowser";

export const Route = createFileRoute("/api")({ component: ApiBrowser });
