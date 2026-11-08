import { createFileRoute } from "@tanstack/react-router";
import { NativeUsers } from "@/components/NativeUsers";

export const Route = createFileRoute("/users")({ component: NativeUsers });
