import type { RecipeListItem } from "./recipe-view";
import type { JsonObject } from "./json";
import type { TableColumn } from "./table-options";
import type { UserfieldDefinition } from "./userfields";
import {
  nativeNumberCell,
  nativeTableCell,
  tableText,
  type NativeTableRow,
} from "./native-table-cell";
import { nativeUserfieldTableCell } from "./userfield-table-cell";

export function recipeOverviewColumns(
  stock: boolean,
  fields: UserfieldDefinition[],
): TableColumn[] {
  return [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    { key: "desired_servings", label: "Desired servings", defaultVisible: false, groupable: true },
    { key: "due_score", label: "Due score", groupable: true },
    {
      key: "requirements",
      label: "Requirements fulfilled",
      rendered: stock,
      groupable: true,
      groupIndex: 8,
    },
    { key: "missing_count", label: "Hidden status for sorting", rendered: false },
    { key: "status", label: "Hidden status for filtering", rendered: false },
    { key: "products", label: "Hidden recipe ingredient product names", rendered: false },
    { key: "status_group", label: "Hidden status for grouping", rendered: false },
    ...fields.map((field) => ({
      key: `custom:${field.name}`,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];
}

export function recipeOverviewCells(
  row: RecipeListItem,
  fields: UserfieldDefinition[],
  status: string,
  group: string,
  precision: number,
  currency: string,
  config?: JsonObject,
): NativeTableRow {
  return {
    name: nativeTableCell(tableText(row.name)),
    desired_servings: nativeNumberCell(tableText(row.desired_servings), row.desired_servings),
    due_score: nativeNumberCell(tableText(row.due_score), row.due_score ?? -Infinity),
    requirements: nativeTableCell(tableText(status)),
    missing_count: nativeNumberCell(
      tableText(row.missing_products_count),
      row.missing_products_count,
    ),
    status: nativeTableCell(tableText(row.stock_status)),
    products: nativeTableCell(tableText(row.product_names)),
    status_group: nativeTableCell(tableText(group)),
    ...Object.fromEntries(
      fields.map((field) => [
        `custom:${field.name}`,
        nativeUserfieldTableCell(
          field,
          row.custom_values?.[field.name] ?? null,
          Object.hasOwn(row.custom_values ?? {}, field.name),
          precision,
          currency,
          config,
        ),
      ]),
    ),
  };
}
