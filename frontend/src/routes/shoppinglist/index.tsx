import { createFileRoute } from "@tanstack/react-router";
import { NativeShopping } from "@/components/NativeShopping";

export const Route = createFileRoute("/shoppinglist/")({
  component: NativeShopping,
});
