import { createFileRoute } from "@tanstack/react-router";
import { NativeCalendar } from "@/components/NativeCalendar";

export const Route = createFileRoute("/calendar")({ component: NativeCalendar });
