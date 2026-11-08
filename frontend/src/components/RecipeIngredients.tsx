import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { RecipeFormContext } from "@/lib/recipe-form-context";
import { recipeIngredientAmount, invalidateRecipeForms } from "@/lib/recipe-form";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import { nativeTableCell, tablePlainText, tableText } from "@/lib/native-table-cell";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useModalDialog } from "@/hooks/useModalDialog";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";
import { RichText } from "./RichDescription";

export function RecipeIngredients({
  recipeId,
  data,
  getSignal,
  onReload,
}: {
  recipeId: number;
  data: RecipeFormContext;
  getSignal: () => AbortSignal | undefined;
  onReload: () => void;
}) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const router = useRouter();
  const client = useQueryClient();
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [deleting, setDeleting] = useState<{ id: number; name: string }>();
  const [note, setNote] = useState<{ text: string; html?: string }>();

  const options = useTableOptions(
    "recipes-pos-table",
    [
      { key: "actions", label: "", configurable: false },
      { key: "product", label: "Product" },
      { key: "amount", label: "Amount" },
      { key: "note", label: "Note" },
      {
        key: "ingredient_group",
        label: "Ingredient group",
        groupable: true,
        defaultVisible: false,
      },
    ],
    { key: "product", descending: false },
    true,
    "ingredient_group",
  );

  const source = data.positions.map((row) => {
    const product = data.products.find((product) => product.id === row.product_id)?.name ?? "";
    const amount = recipeIngredientAmount(row, data);
    const unit = data.units.find((unit) => unit.id === row.qu_id);

    const variable =
      row.variable_amount !== null && row.variable_amount !== "" && row.variable_amount !== "0";

    const display = variable
      ? row.variable_amount!
      : amount.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: preferences.amountPrecision,
        });

    const label = unit ? nativeQuantityUnit(unit, amount, pluralIndex) : "";

    const cells = {
      product: nativeTableCell(tableText(product)),
      amount: nativeTableCell(
        `${tableText(display)} ${tableText(label)}${variable ? `<div>${tableText(t("Variable amount"))}</div>` : ""}`,
      ),
      note: nativeTableCell(""),
      ingredient_group: nativeTableCell(tableText(row.ingredient_group)),
    };

    return {
      key: String(row.id),
      row: { value: row, product, display, label, variable, cells },
      cells,
    };
  });

  const rows = useTableOrder(source, options);

  const remove = useMutation({
    mutationFn: (id: number) =>
      request(`/api/objects/recipes_pos/${id}`, { method: "DELETE", signal: getSignal() }),
    onSuccess: async () => {
      await invalidateRecipeForms(client);

      if (!getSignal()?.aborted)
        window.postMessage(
          { Message: "IngredientsChanged", Payload: null },
          window.location.origin,
        );
    },
    onError: (error) => {
      if (!getSignal()?.aborted) console.error(error);
    },
  });

  const base = router.buildLocation({
    to: "/recipe/$recipeId",
    params: { recipeId: String(recipeId) },
    search: {},
  }).publicHref;

  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "form" });
  };

  return (
    <section aria-label={t("Ingredients list")}>
      <div className="section-heading">
        <h2>{t("Ingredients list")}</h2>
        <a className="btn" href={`${base}/pos/new?embedded`} onClick={open}>
          {t("Add")}
        </a>
      </div>
      <StockTableStatus options={options} />
      <div className="journal-table-scroll">
        <table className="stock-table">
          <caption className="sr-only">{t("Ingredients list")}</caption>
          <thead>
            <tr>
              <StockTableCells options={options} headers>
                <th>
                  <StockTableOptions options={options} onReset={onReload} />
                </th>
                {options.columns.slice(1).map((column) => (
                  <th key={column.key}>
                    <button
                      type="button"
                      className="journal-sort"
                      onClick={(event) => options.sortBy(column.key, event.shiftKey)}
                    >
                      {t(column.label)}
                    </button>
                  </th>
                ))}
              </StockTableCells>
            </tr>
          </thead>
          <StockTableRows
            options={options}
            groups={rows.map((row) => {
              const cell =
                row.cells[
                  options.groupColumn === "ingredient_group" ? "ingredient_group" : "product"
                ];

              const name = tablePlainText(cell.html);

              return { key: cell.html, label: name, name };
            })}
          >
            {rows.map((row) => (
              <tr key={row.value.id}>
                <StockTableCells options={options}>
                  <td className="row-actions">
                    <a
                      className="btn btn-sm"
                      aria-label={t("Edit this item")}
                      href={`${base}/pos/${row.value.id}?embedded&product=${row.value.product_id}`}
                      onClick={open}
                    >
                      {t("Edit")}
                    </a>
                    <button
                      className="btn btn-sm"
                      type="button"
                      aria-label={t("Delete this item")}
                      onClick={() => setDeleting({ id: row.value.id, name: row.product })}
                    >
                      {t("Delete")}
                    </button>
                  </td>
                  <th scope="row">{row.product}</th>
                  <td>
                    {row.display} {row.label}
                    {row.variable ? <div className="field-hint">{t("Variable amount")}</div> : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!row.value.note || row.value.note === "0"}
                      onClick={() =>
                        setNote({ text: row.value.note ?? "", html: row.value.note_html })
                      }
                    >
                      {t("Show notes")}
                    </button>
                  </td>
                  <td>{row.value.ingredient_group}</td>
                </StockTableCells>
              </tr>
            ))}
          </StockTableRows>
        </table>
      </div>
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t('Are you sure you want to delete recipe ingredient "%s"?', deleting.name)}
          pending={false}
          error={null}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            remove.mutate(deleting.id);
            setDeleting(undefined);
          }}
        />
      ) : null}
      {note !== undefined ? (
        <IngredientNote note={note} onClose={() => setNote(undefined)} />
      ) : null}
    </section>
  );
}

function IngredientNote({
  note,
  onClose,
}: {
  note: { text: string; html?: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Show notes")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {note.html !== undefined ? <RichText html={note.html} /> : <p>{note.text}</p>}
      <button type="button" className="btn btn-primary" onClick={onClose}>
        {t("OK")}
      </button>
    </dialog>
  );
}
