import { createFileRoute } from "@tanstack/react-router";
import { NativeProducts } from "@/components/NativeProducts";

export const Route = createFileRoute("/products/")({ component: NativeProducts });
