import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys, request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { RecipeListItem, RecipeListMode, RecipeOverviewSearch } from "@/lib/recipe-view";
import { recipeOverviewCells, recipeOverviewColumns } from "@/lib/recipes-overview";
import { userfieldsQuery } from "@/lib/userfields";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import { tablePlainText } from "@/lib/native-table-cell";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { useNativeDocumentReload } from "@/lib/native-document";
import { userSettingsQuery } from "@/hooks/queries";
import { useGenericError } from "@/hooks/useGenericError";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import { EntityManager } from "./EntityManager";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";
import { FullscreenCard, FullscreenToggle } from "./FullscreenCard";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";
import { RecipeReader } from "./RecipeReader";
import { RecipeMealPlanAction } from "./RecipeMealPlan";
import { GrocycodeActions } from "./GrocycodeActions";
import { NativeRecipeTableRowActions } from "./NativeRecipeTableRowActions";
import { StockTableCells, StockTableOptions, StockTableStatus } from "./StockTableOptions";
import { NativeUserfieldValue, NativeUserfieldRows } from "./NativeUserfieldTable";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";

export function RecipeOverview({
  search,
  onSearchChange,
}: {
  search: RecipeOverviewSearch;
  onSearchChange: (change: Partial<RecipeOverviewSearch>) => void;
}) {
  const { t, n } = useI18n();
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/recipes");
  const features = useFeatures();
  const preferences = usePreferences();
  const { recipesSideBySide } = preferences;
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const sideBySide = settings.data?.recipes_show_list_side_by_side;
  const split = sideBySide === undefined || (Boolean(sideBySide) && sideBySide !== "0");
  const client = useQueryClient();
  const genericError = useGenericError();
  const printLabel = useNativeLabelPrint();
  const overview = useQuery({ queryKey: queryKeys.recipeOverview, queryFn: api.getRecipeOverview });
  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "recipes" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const ready =
    overview.isSuccess && definitions.isSuccess && settings.isSuccess && !settings.isFetching;

  const options = useTableOptions(
    "recipes-table",
    recipeOverviewColumns(features.enabled("STOCK"), fields),
    { key: "name", descending: false },
    ready,
  );

  const [reloading, setReloading] = useState(false);
  const [editing, setEditing] = useState(false);

  const snapshot = useTableSnapshot(
    overview.data,
    ready && options.ready && !overview.isFetching && !definitions.isFetching && !reloading,
    options.resetVersion + (editing ? overview.dataUpdatedAt : 0),
    overview.dataUpdatedAt,
  );

  const [savedTab, setSavedTab] = useState<RecipeListMode>(() =>
    localStorage.getItem("recipes_last_tab_id") === "gallery-tab" ? "gallery" : "list",
  );

  const mode = search.tab === "gallery" || savedTab === "gallery" ? "gallery" : "list";

  const [galleryFilter, setGalleryFilter] = useState<{ kind: "search" | "status"; value: string }>({
    kind:
      nativeQueryParameter(router.history.location.search, "status") !== undefined
        ? "status"
        : "search",
    value: search.status === "all" ? "" : (search.status ?? search.search ?? ""),
  });

  const [chosen, setChosen] = useState<number | null | undefined>();
  const [previousRecipe, setPreviousRecipe] = useState(search.recipe);

  if (previousRecipe !== search.recipe) {
    setPreviousRecipe(search.recipe);
    setChosen(undefined);
    options.reload();
  }

  const [overlay, setOverlay] = useState<number | undefined>();
  const closeOverlay = useCallback(() => setOverlay(undefined), []);
  const [defaultSelection, setDefaultSelection] = useState<{ version: number; id?: number }>();
  const listTab = useRef<HTMLButtonElement>(null);
  const galleryTab = useRef<HTMLButtonElement>(null);
  const prefix = useId();

  const statusText = (recipe: RecipeListItem) =>
    recipe.stock_status === "Xenoughinstock"
      ? t("Enough in stock")
      : recipe.stock_status === "enoughinstockwithshoppinglist"
        ? n(
            recipe.missing_products_count,
            "Not enough in stock, %s ingredient missing but already on the shopping list",
            "Not enough in stock, %s ingredients missing but already on the shopping list",
          )
        : n(
            recipe.missing_products_count,
            "Not enough in stock, %s ingredient missing",
            "Not enough in stock, %s ingredients missing",
          );

  const groupText = (row: RecipeListItem) =>
    row.stock_status === "Xenoughinstock"
      ? t("Enough in stock")
      : row.stock_status === "enoughinstockwithshoppinglist"
        ? t("Not enough in stock, but already on the shopping list")
        : t("Not enough in stock");

  const source = (snapshot?.value ?? []).map((row) => ({
    key: String(row.id),
    row,
    cells: recipeOverviewCells(
      row,
      fields,
      statusText(row),
      groupText(row),
      preferences.priceDisplayPrecision,
      String(features.query.data?.CURRENCY ?? "USD"),
      features.query.data,
    ),
  }));

  const cells = new Map(source.map((record) => [record.row.id, record.cells]));
  const groupedField = fields.find((field) => options.groupColumn === `custom:${field.name}`);
  const ordered = useTableOrder(source, options, !!snapshot);

  if (snapshot && defaultSelection?.version !== options.resetVersion)
    setDefaultSelection({ version: options.resetVersion, id: ordered[0]?.id });

  const selected = search.recipe ?? snapshot?.value[0]?.id;
  const highlighted = chosen === undefined ? (search.recipe ?? defaultSelection?.id) : chosen;

  const visible = ordered.filter(
    (row) =>
      (!search.status || search.status === "all" || row.stock_status === search.status) &&
      matchesTableSearch(
        Object.values(cells.get(row.id)!)
          .map((cell) => cell.search)
          .join("  "),
        search.search ?? "",
      ),
  );

  const gallery = (snapshot?.value ?? []).filter((row) =>
    galleryFilter.kind === "status"
      ? !galleryFilter.value || row.stock_status === galleryFilter.value
      : `${row.name} ${row.product_names}`
          .toLowerCase()
          .includes(galleryFilter.value.toLowerCase()),
  );

  const lifetime = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [deleting, setDeleting] = useState<RecipeListItem>();
  useEffect(() => {
    const scope = new AbortController();
    lifetime.current = scope;

    return () => scope.abort();
  }, []);

  const reload = async () => {
    if (reloadDocument()) return;
    const ownGeneration = ++generation.current;
    setReloading(true);
    setDeleting(undefined);
    setOverlay(undefined);
    setChosen(undefined);

    try {
      const result = await overview.refetch();

      if (
        !lifetime.current?.signal.aborted &&
        ownGeneration === generation.current &&
        result.isSuccess
      )
        options.reload();
    } finally {
      if (!lifetime.current?.signal.aborted && ownGeneration === generation.current)
        setReloading(false);
    }
  };

  const changed = async () => {
    await Promise.all(
      ["recipe-overview", "recipe-view", "recipe-form", "recipes", "objects"].map((key) =>
        client.invalidateQueries({ queryKey: [key], refetchType: "none" }),
      ),
    );
  };

  const remove = useMutation({
    mutationFn: (input: { id: number; generation: number }) =>
      request(`/api/objects/recipes/${input.id}`, {
        method: "DELETE",
        signal: lifetime.current?.signal,
      }),
    onSuccess: async (_result, input) => {
      await changed();

      if (lifetime.current?.signal.aborted || input.generation !== generation.current) return;
      setGalleryFilter({ kind: "status", value: "" });
      onSearchChange({ recipe: undefined, search: undefined, status: undefined, tab: undefined });
      await reload();
    },
    onError: (error, input) => {
      if (!lifetime.current?.signal.aborted && input.generation === generation.current)
        console.error(error);
    },
  });

  const copy = useMutation({
    mutationFn: async (input: { id: number; generation: number }) => api.copyRecipe(input.id),
    onSuccess: async (id, input) => {
      await changed();

      if (lifetime.current?.signal.aborted || input.generation !== generation.current) return;
      setGalleryFilter({ kind: "status", value: "" });
      onSearchChange({ recipe: Number(id), search: undefined, status: undefined, tab: undefined });
      await reload();
    },
    onError: (error, input) => {
      if (!lifetime.current?.signal.aborted && input.generation === generation.current)
        genericError("Error while saving, probably this item already exists", error);
    },
  });

  const open = (id: number) => {
    setChosen(id);

    if (recipesSideBySide) {
      if (mode === "gallery") {
        reloadDocument();
        void router.navigate({ to: "/recipes", search: { tab: "gallery", recipe: id } });
      } else {
        const current = router.history.location.search.split("recipe=")[1];

        if (String(id) !== current) reloadDocument();
        onSearchChange({ recipe: id });
      }
    } else setOverlay(id);
  };

  const select = (event: MouseEvent, id: number) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    open(id);
  };

  const selectTab = (tab: RecipeListMode) => {
    setSavedTab(tab);
    localStorage.setItem("recipes_last_tab_id", `${tab}-tab`);
    onSearchChange({ tab: tab === "gallery" ? "gallery" : undefined });
  };

  const onTabKey = (event: KeyboardEvent) => {
    let next: RecipeListMode;

    if (event.key === "Home") next = "list";
    else if (event.key === "End") next = "gallery";
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      next = mode === "list" ? "gallery" : "list";
    else return;
    event.preventDefault();
    selectTab(next);
    (next === "list" ? listTab : galleryTab).current?.focus();
  };

  const heading = (key: string, label: string) => (
    <th
      key={key}
      scope="col"
      aria-sort={
        options.sort.key === key ? (options.sort.descending ? "descending" : "ascending") : "none"
      }
    >
      <button className="recipe-sort" onClick={(event) => options.sortBy(key, event.shiftKey)}>
        {label}
        <span className="sr-only">: {t("Sort")}</span>
      </button>
    </th>
  );

  const badge = (recipe: RecipeListItem) => (
    <span
      className="badge"
      data-tone={
        recipe.stock_status === "Xenoughinstock"
          ? "ok"
          : recipe.stock_status === "enoughinstockwithshoppinglist"
            ? "warn"
            : "danger"
      }
    >
      {statusText(recipe)}
    </span>
  );

  const actions = (recipe: RecipeListItem, gallery = false) => (
    <div className="recipe-row-actions">
      <Link
        className="btn btn-ghost btn-sm hide-when-embedded hide-on-fullscreen-card"
        to="/recipe/$recipeId"
        params={{ recipeId: String(recipe.id) }}
        aria-label={t("Edit %s", recipe.name)}
      >
        {t("Edit this item")}
      </Link>
      {gallery ? (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDeleting(recipe)}
          >
            {t("Delete this item")}
          </button>
          <RecipeMealPlanAction id={recipe.id} name={recipe.name} />
          <GrocycodeActions kind="recipe" id={recipe.id} name={recipe.name} />
        </>
      ) : (
        <NativeRecipeTableRowActions
          recipe={recipe}
          onDelete={() => setDeleting(recipe)}
          onCopy={() => copy.mutate({ id: recipe.id, generation: generation.current })}
          onPrint={() => printLabel(`/api/recipes/${recipe.id}/printlabel`)}
        />
      )}
    </div>
  );

  if (search.embedded) {
    if (selected !== undefined) return <RecipePreview id={selected} overlay />;

    if (overview.isError) return <ErrorBlock message={overview.error.message} />;

    return overview.isPending ? (
      <LoadingBlock />
    ) : (
      <p className="empty-state">{t("No recipes yet.")}</p>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Recipes")}
        actions={
          <>
            <Link className="btn btn-primary" to="/recipe/$recipeId" params={{ recipeId: "new" }}>
              {t("Add")}
            </Link>
            <Link className="btn btn-ghost" to="/recipessettings">
              {t("Recipes settings")}
            </Link>
            <button
              className="btn btn-ghost"
              aria-pressed={editing}
              onClick={() => {
                if (editing) options.reload();
                setEditing((value) => !value);
              }}
            >
              {t(editing ? "Close editor" : "Edit recipes")}
            </button>
          </>
        }
      />
      {editing ? <EntityManager entity="recipes" fixed={{ type: "normal" }} /> : null}
      <div className="recipes-layout" data-split={(split && selected !== undefined) || undefined}>
        <section aria-label={t("Recipe list")} className="recipes-catalog">
          <div className="toolbar recipe-filters">
            <label className="field">
              <span>{t("Search recipes")}</span>
              <input
                type="search"
                value={search.search ?? ""}
                onChange={(event) => {
                  setGalleryFilter({ kind: "search", value: event.target.value });
                  onSearchChange({ search: event.target.value || undefined });
                }}
              />
            </label>
            <label className="field">
              <span>{t("Status")}</span>
              <select
                value={search.status ?? "all"}
                onChange={(event) => {
                  setGalleryFilter({
                    kind: "status",
                    value: event.target.value === "all" ? "" : event.target.value,
                  });
                  onSearchChange({
                    status:
                      event.target.value === "all" ? undefined : recipeStatus(event.target.value),
                  });
                }}
              >
                <option value="all">{t("All")}</option>
                <option value="Xenoughinstock">{t("Enough in stock")}</option>
                <option value="enoughinstockwithshoppinglist">
                  {t("Not enough in stock, but already on the shopping list")}
                </option>
                <option value="notenoughinstock">{t("Not enough in stock")}</option>
              </select>
            </label>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setGalleryFilter({ kind: "status", value: "" });
                onSearchChange({ search: undefined, status: undefined });
              }}
            >
              {t("Clear filter")}
            </button>
          </div>
          <div className="tabs recipe-tabs" role="tablist" aria-label={t("Recipe views")}>
            <button
              ref={listTab}
              type="button"
              role="tab"
              id={`${prefix}-list`}
              aria-controls={`${prefix}-results`}
              aria-selected={mode === "list"}
              tabIndex={mode === "list" ? 0 : -1}
              onClick={() => selectTab("list")}
              onKeyDown={onTabKey}
            >
              {t("List")}
            </button>
            <button
              ref={galleryTab}
              type="button"
              role="tab"
              id={`${prefix}-gallery`}
              aria-controls={`${prefix}-results`}
              aria-selected={mode === "gallery"}
              tabIndex={mode === "gallery" ? 0 : -1}
              onClick={() => selectTab("gallery")}
              onKeyDown={onTabKey}
            >
              {t("Gallery")}
            </button>
          </div>
          <div id={`${prefix}-results`} role="tabpanel" aria-labelledby={`${prefix}-${mode}`}>
            {overview.isPending ? <LoadingBlock label={t("Loading recipes…")} /> : null}
            {overview.isError ? <ErrorBlock message={overview.error.message} /> : null}
            <StockTableStatus options={options} />
            {definitions.isError ? <ErrorBlock message={definitions.error.message} /> : null}
            {snapshot && !(mode === "gallery" ? gallery : visible).length ? (
              <p className="empty-state">
                {t(snapshot.value.length ? "No recipe matches this filter." : "No recipes yet.")}
              </p>
            ) : null}
            {mode === "list" && snapshot ? (
              <div className="recipe-table-scroll">
                <table className="recipe-overview-table">
                  <caption className="sr-only">{t("Recipes")}</caption>
                  <thead>
                    <tr>
                      <StockTableCells options={options} headers>
                        <th>
                          <StockTableOptions options={options} onReset={() => void reload()} />
                        </th>
                        {heading("name", t("Name"))}
                        {heading("desired_servings", t("Desired servings"))}
                        {heading("due_score", t("Due score"))}
                        {features.enabled("STOCK")
                          ? heading("requirements", t("Requirements fulfilled"))
                          : null}
                        {fields.map((field) => heading(`custom:${field.name}`, field.caption))}
                      </StockTableCells>
                    </tr>
                  </thead>
                  <NativeUserfieldRows
                    options={options}
                    interactiveField={
                      groupedField &&
                      ["image", "file", "link", "link-with-title"].includes(groupedField.type)
                        ? groupedField
                        : undefined
                    }
                    groups={visible.map((row) => {
                      const cell = cells.get(row.id)![options.groupColumn ?? "name"];
                      const name = tablePlainText(cell?.html ?? "");
                      const value = row.custom_values?.[groupedField?.name ?? ""] ?? null;

                      const present = Object.hasOwn(
                        row.custom_values ?? {},
                        groupedField?.name ?? "",
                      );

                      return {
                        key: cell?.html ?? "",
                        label: groupedField ? (
                          <NativeUserfieldValue
                            field={groupedField}
                            value={value}
                            present={present}
                          />
                        ) : (
                          name
                        ),
                        name,
                        value,
                        present,
                      };
                    })}
                  >
                    {visible.map((recipe) => (
                      <tr
                        key={recipe.id}
                        data-recipe-id={recipe.id}
                        data-selected={highlighted === recipe.id || undefined}
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest("a, button, [popover], td:first-child")
                          )
                            return;

                          if (highlighted === recipe.id) setChosen(null);
                          else open(recipe.id);
                        }}
                      >
                        <StockTableCells options={options}>
                          <td className="recipe-plan-cell">{actions(recipe)}</td>
                          <td>
                            <Link
                              to="/recipes/$recipeId"
                              params={{ recipeId: String(recipe.id) }}
                              aria-current={highlighted === recipe.id ? "true" : undefined}
                              onClick={(event) => select(event, recipe.id)}
                            >
                              {recipe.name}
                            </Link>
                          </td>
                          <td className="num">{recipe.desired_servings}</td>
                          <td className="num">{recipe.due_score ?? ""}</td>
                          {features.enabled("STOCK") ? <td>{badge(recipe)}</td> : null}
                          {fields.map((field) => (
                            <td key={field.id}>
                              <NativeUserfieldValue
                                field={field}
                                value={recipe.custom_values?.[field.name] ?? null}
                                present={Object.hasOwn(recipe.custom_values ?? {}, field.name)}
                              />
                            </td>
                          ))}
                        </StockTableCells>
                      </tr>
                    ))}
                  </NativeUserfieldRows>
                </table>
              </div>
            ) : null}
            {mode === "gallery" ? (
              <ul className="recipe-gallery">
                {gallery.map((recipe) => (
                  <li key={recipe.id} data-selected={search.recipe === recipe.id || undefined}>
                    <Link
                      to="/recipes/$recipeId"
                      params={{ recipeId: String(recipe.id) }}
                      aria-label={recipe.name}
                      aria-current={search.recipe === recipe.id ? "true" : undefined}
                      onClick={(event) => select(event, recipe.id)}
                    >
                      {recipe.picture_file_name ? (
                        <EntityPicture
                          group="recipepictures"
                          source={recipe.picture_file_name}
                          label={t("%s picture", recipe.name)}
                        />
                      ) : null}
                      <h3>{recipe.name}</h3>
                      {badge(recipe)}
                    </Link>
                    <div className="recipe-gallery-actions">{actions(recipe, true)}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
        {split && selected !== undefined ? (
          <RecipePreview key={selected} id={selected} focusOnLoad={search.recipe !== undefined} />
        ) : null}
      </div>
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t('Are you sure you want to delete recipe "%s"?', deleting.name)}
          pending={false}
          error={null}
          onClose={() => setDeleting(undefined)}
          onDelete={() => {
            remove.mutate({ id: deleting.id, generation: generation.current });
            setDeleting(undefined);
          }}
        />
      ) : null}
      {overlay !== undefined ? (
        <RecipePreview key={overlay} id={overlay} overlay onClose={closeOverlay} />
      ) : null}
    </>
  );
}

function recipeStatus(value: string) {
  if (
    value === "Xenoughinstock" ||
    value === "enoughinstockwithshoppinglist" ||
    value === "notenoughinstock"
  )
    return value;

  return undefined;
}

function RecipePreview({
  id,
  overlay = false,
  onClose,
  focusOnLoad = false,
}: {
  id: number;
  overlay?: boolean;
  onClose?: () => void;
  focusOnLoad?: boolean;
}) {
  const { t } = useI18n();
  const preview = useRef<HTMLDivElement>(null);

  const view = useQuery({
    queryKey: queryKeys.recipeView(id),
    queryFn: () => api.getRecipeView(id),
  });

  useEffect(() => {
    if (focusOnLoad && !view.isPending && window.innerWidth < 768) {
      preview.current?.scrollIntoView({ block: "start" });
      preview.current?.focus({ preventScroll: true });
    }
  }, [focusOnLoad, view.isPending]);

  if (overlay && view.isSuccess) return <RecipeReader view={view.data} overlay onClose={onClose} />;

  const content = view.isError ? (
    <>
      <ErrorBlock message={view.error.message} />
      <button className="btn" onClick={() => void view.refetch()}>
        {t("Retry")}
      </button>
    </>
  ) : (
    <LoadingBlock />
  );

  return overlay ? (
    <FullscreenCard label={t("Recipe")} defaultExpanded onClose={onClose}>
      <FullscreenToggle />
      {content}
    </FullscreenCard>
  ) : (
    <div ref={preview} className="recipe-selection" tabIndex={-1}>
      {view.isSuccess ? <RecipeReader view={view.data} /> : content}
    </div>
  );
}
