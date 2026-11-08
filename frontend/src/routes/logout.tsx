import { createFileRoute } from "@tanstack/react-router";
import { NativeLogout } from "@/components/NativeLogout";

export const Route = createFileRoute("/logout")({ component: NativeLogout });
