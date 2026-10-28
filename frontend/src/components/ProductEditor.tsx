import type { ComponentProps } from "react";
import { EntityManager } from "./EntityManager";
import { ProductRelatedData } from "./ProductRelatedData";

export function ProductEditor(
  props: Omit<ComponentProps<typeof EntityManager>, "entity" | "related">,
) {
  return <EntityManager {...props} entity="products" related={ProductRelatedData} />;
}
