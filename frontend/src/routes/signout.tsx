import { createFileRoute } from "@tanstack/react-router";
import { LogoutPage } from "@/components/LogoutPage";

export const Route = createFileRoute("/signout")({ component: LogoutPage });
