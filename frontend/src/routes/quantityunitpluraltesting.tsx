import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { QuantityUnitPluralTesting } from "@/components/QuantityUnitPluralTesting";

export const Route = createFileRoute("/quantityunitpluraltesting")({
  validateSearch: z
    .object({
      qu: z.string().optional().catch(undefined),
      embedded: z.string().optional().catch(undefined),
    })
    .passthrough(),
  component: PluralRoute,
});

function PluralRoute() {
  const { qu } = Route.useSearch();

  return <QuantityUnitPluralTesting key={qu ?? ""} initialUnit={qu} />;
}
