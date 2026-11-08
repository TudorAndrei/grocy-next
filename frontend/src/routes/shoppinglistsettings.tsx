import { createFileRoute } from "@tanstack/react-router";
import { ShoppingListSettings } from "@/components/ShoppingListSettings";

export const Route = createFileRoute("/shoppinglistsettings")({ component: ShoppingListSettings });
