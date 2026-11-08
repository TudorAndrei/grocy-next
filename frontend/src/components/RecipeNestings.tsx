import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { RecipeFormContext, RecipeFormNesting } from "@/lib/recipe-form-context";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { nativeNumberCell, nativeTableCell, tableText } from "@/lib/native-table-cell";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useGenericError } from "@/hooks/useGenericError";
import { NumberPicker } from "./NumberPicker";
import { RecipePicker } from "./RecipePicker";
import { StockTableCells, StockTableOptions, StockTableStatus } from "./StockTableOptions";

type Props = {
  recipeId: number;
  data: RecipeFormContext;
  prepare: () => Promise<boolean>;
  getSignal: () => AbortSignal | undefined;
  onReload: () => void;
};

const columns: TableColumn[] = [
  { key: "actions", label: "", configurable: false },
  { key: "recipe", label: "Recipe" },
  { key: "servings", label: "Servings" },
];

export function RecipeNestings({ recipeId, data, prepare, getSignal, onReload }: Props) {
  const { t } = useI18n();
  const genericError = useGenericError();

  const options = useTableOptions("recipes-includes-table", columns, {
    key: "recipe",
    descending: false,
  });

  const { amountPrecision } = usePreferences();
  const [editing, setEditing] = useState<{ id: number | null; version: number }>();
  const [deleting, setDeleting] = useState<RecipeFormNesting>();
  const [choice, setChoice] = useState("");
  const [choiceText, setChoiceText] = useState("");
  const [servings, setServings] = useState("1");
  const controller = useRef<AbortController>(undefined);
  const modalVersion = useRef(0);

  useEffect(() => {
    const scope = new AbortController();
    controller.current = scope;

    return () => controller.current?.abort();
  }, []);

  const signal = () => {
    const page = getSignal();
    const scope = controller.current?.signal;

    return page && scope ? AbortSignal.any([page, scope]) : (page ?? scope);
  };

  const name = (row: RecipeFormNesting) =>
    data.recipes.find((recipe) => recipe.id === row.includes_recipe_id)?.name ?? "";

  const ordered = useTableOrder(
    data.nestings.map((row) => ({
      key: String(row.id),
      row,
      cells: {
        recipe: nativeTableCell(tableText(name(row))),
        servings: nativeNumberCell(tableText(row.servings), Number(row.servings)),
      },
    })),
    options,
  );

  const open = async (row?: RecipeFormNesting) => {
    const scope = signal();

    if (!(await prepare()) || scope?.aborted) return;

    if (row) {
      const selected = data.recipes.find((recipe) => recipe.id === row.includes_recipe_id);
      setChoice(selected ? String(selected.id) : "");
      setChoiceText(selected?.name ?? "");
      // Editing sets the raw attribute value; it does not rerun locale rounding.
      setServings(String(row.servings ?? ""));
    } else {
      setChoice("");
      setChoiceText("");
    }

    modalVersion.current += 1;
    setEditing({ id: row?.id ?? null, version: modalVersion.current });
  };

  const changed = () =>
    window.postMessage({ Message: "IngredientsChanged", Payload: null }, window.location.origin);

  const save = async () => {
    if (!editing) return;
    const scope = signal();

    try {
      await request(
        editing.id === null
          ? "/api/objects/recipes_nestings"
          : `/api/objects/recipes_nestings/${editing.id}`,
        {
          method: editing.id === null ? "POST" : "PUT",
          body: JSON.stringify({ includes_recipe_id: choice, servings, recipe_id: recipeId }),
          signal: scope,
        },
      );

      if (!scope?.aborted) changed();
    } catch (error) {
      if (!scope?.aborted)
        genericError(
          "Error while saving, probably this item already exists",
          error instanceof Error ? error : String(error),
        );
    }
  };

  const remove = async (row: RecipeFormNesting) => {
    const scope = signal();
    setDeleting(undefined);

    try {
      await request(`/api/objects/recipes_nestings/${row.id}`, {
        method: "DELETE",
        signal: scope,
      });

      if (!scope?.aborted) changed();
    } catch (error) {
      if (!scope?.aborted) console.error(error);
    }
  };

  return (
    <section className="recipe-nestings" aria-label={t("Included recipes")}>
      <div className="section-heading">
        <h2>{t("Included recipes")}</h2>
        <button type="button" className="btn" onClick={() => void open()}>
          {t("Add")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {options.ready ? (
        <div className="journal-table-scroll">
          <table id="recipes-includes-table" className="stock-table">
            <caption className="sr-only">{t("Included recipes")}</caption>
            <thead>
              <tr>
                <StockTableCells options={options} headers>
                  <th scope="col">
                    <StockTableOptions
                      options={options}
                      onReset={() => {
                        controller.current?.abort();
                        controller.current = new AbortController();
                        modalVersion.current += 1;
                        setEditing(undefined);
                        setDeleting(undefined);
                        onReload();
                      }}
                    />
                  </th>
                  {columns.slice(1).map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        options.sort.key !== column.key
                          ? "none"
                          : options.sort.descending
                            ? "descending"
                            : "ascending"
                      }
                    >
                      <button
                        className="journal-sort"
                        type="button"
                        onClick={(event) => options.sortBy(column.key, event.shiftKey)}
                      >
                        {t(column.label)}
                      </button>
                    </th>
                  ))}
                </StockTableCells>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={row.id}>
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void open(row)}
                      >
                        {t("Edit this item")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDeleting(row)}
                      >
                        {t("Delete this item")}
                      </button>
                    </td>
                    <th scope="row">{name(row)}</th>
                    <td>{row.servings}</td>
                  </StockTableCells>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? (
        <NestingDialog
          key={editing.version}
          title={editing.id === null ? "Add included recipe" : "Edit included recipe"}
          data={data}
          choice={choice}
          choiceText={choiceText}
          servings={servings}
          precision={amountPrecision}
          onChoice={(value, text) => {
            setChoice(value);
            setChoiceText(text);
          }}
          onServings={setServings}
          onSave={() => void save()}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {deleting ? (
        <DeleteNesting
          name={name(deleting)}
          onClose={() => setDeleting(undefined)}
          onDelete={() => void remove(deleting)}
        />
      ) : null}
    </section>
  );
}

function NestingDialog({
  title,
  data,
  choice,
  choiceText,
  servings,
  precision,
  onChoice,
  onServings,
  onSave,
  onClose,
}: {
  title: string;
  data: RecipeFormContext;
  choice: string;
  choiceText: string;
  servings: string;
  precision: number;
  onChoice: (value: string, text: string) => void;
  onServings: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const step = precision <= 0 ? "1" : `0.${"0".repeat(precision - 1)}1`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (pickerOpen || !choice || !event.currentTarget.reportValidity()) return;
    onSave();
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t(title)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();

        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <h2>{t(title)}</h2>
      <form aria-label={t(title)} onSubmit={submit}>
        <RecipePicker
          recipes={data.recipes.map((row) => ({ id: row.id, name: row.name ?? "" }))}
          value={choice}
          text={choiceText}
          disabled={false}
          required
          hint=""
          chooseOnEnter
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onChange={onChoice}
        />
        <label className="field" htmlFor={`${id}-servings`}>
          {t("Servings")}
        </label>
        <NumberPicker
          id={`${id}-servings`}
          label="Servings"
          value={servings}
          onChange={onServings}
          required
          min={step}
          step={step}
        />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary">
            {t("Save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function DeleteNesting({
  name,
  onClose,
  onDelete,
}: {
  name: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Delete this item")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <p>{t('Are you sure you want to remove the included recipe "%s"?', name)}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
