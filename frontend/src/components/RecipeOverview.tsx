import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { RecipeListItem, RecipeListMode, RecipeOverviewSearch } from "@/lib/recipe-view";
import { EntityManager } from "./EntityManager";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";
import { FullscreenCard, FullscreenToggle } from "./FullscreenCard";
import { Icon } from "./Icon";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";
import { RecipeReader } from "./RecipeReader";
import { RecipeMealPlanAction } from "./RecipeMealPlan";

type SortKey = "name" | "desired_servings" | "due_score" | "stock_status";

export function RecipeOverview({
  search,
  onSearchChange,
}: {
  search: RecipeOverviewSearch;
  onSearchChange: (change: Partial<RecipeOverviewSearch>) => void;
}) {
  const { t, n } = useI18n();
  const features = useFeatures();
  const { recipesSideBySide, formatAmount } = usePreferences();
  const overview = useQuery({ queryKey: queryKeys.recipeOverview, queryFn: api.getRecipeOverview });
  const [editing, setEditing] = useState(false);

  const [savedTab, setSavedTab] = useState<RecipeListMode>(() =>
    localStorage.getItem("recipes_last_tab_id") === "gallery-tab" ? "gallery" : "list",
  );

  const mode = search.tab ?? savedTab;

  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "name",
    descending: false,
  });

  const [showServings, setShowServings] = useState(false);
  const [chosen, setChosen] = useState<number | undefined>();
  const [previousRecipe, setPreviousRecipe] = useState(search.recipe);

  if (previousRecipe !== search.recipe) {
    setPreviousRecipe(search.recipe);
    setChosen(undefined);
  }

  const [overlay, setOverlay] = useState<number | undefined>();
  const closeOverlay = useCallback(() => setOverlay(undefined), []);
  const selected = search.recipe ?? overview.data?.[0]?.id;
  const highlighted = recipesSideBySide ? selected : (chosen ?? selected);
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

  const query = (search.search ?? "").trim().toLowerCase();
  const words = query.match(/"[^"]+"|\S+/g)?.map((word) => word.replace(/^"|"$/g, "")) ?? [];

  const visible = (overview.data ?? [])
    .filter((recipe) => {
      if (search.status && recipe.stock_status !== search.status) return false;
      const galleryText = `${recipe.name} ${recipe.product_names}`.toLowerCase();

      if (mode === "gallery") return galleryText.includes(query);

      const listText =
        `${galleryText} ${recipe.desired_servings} ${recipe.due_score ?? ""} ${statusText(recipe)}`.toLowerCase();

      return words.every((word) => listText.includes(word));
    })
    .sort((left, right) => {
      let difference: number;

      if (sort.key === "name") {
        const a = left.name.toLowerCase();
        const b = right.name.toLowerCase();
        difference = a < b ? -1 : a > b ? 1 : 0;
      } else if (sort.key === "stock_status")
        difference = left.missing_products_count - right.missing_products_count;
      else difference = (left[sort.key] ?? 0) - (right[sort.key] ?? 0);

      return sort.descending ? -difference : difference;
    });

  const open = (id: number) => {
    setChosen(id);

    if (recipesSideBySide) onSearchChange({ recipe: id });
    else setOverlay(id);
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

  const heading = (key: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}
    >
      <button
        className="recipe-sort"
        onClick={() => setSort({ key, descending: sort.key === key && !sort.descending })}
      >
        {label}
        <span className="sr-only">: {t("Sort")}</span>
        {sort.key === key ? (
          <Icon name="sort" className={sort.descending ? "recipe-sort-desc" : undefined} />
        ) : null}
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
          <button
            className="btn btn-ghost"
            aria-pressed={editing}
            onClick={() => setEditing((value) => !value)}
          >
            {t(editing ? "Close editor" : "Edit recipes")}
          </button>
        }
      />
      {editing ? <EntityManager entity="recipes" fixed={{ type: "normal" }} /> : null}
      <div
        className="recipes-layout"
        data-split={(recipesSideBySide && selected !== undefined) || undefined}
      >
        <section aria-label={t("Recipe list")} className="recipes-catalog">
          <div className="toolbar recipe-filters">
            <label className="field">
              <span>{t("Search recipes")}</span>
              <input
                type="search"
                value={search.search ?? ""}
                onChange={(event) => onSearchChange({ search: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              <span>{t("Status")}</span>
              <select
                value={search.status ?? "all"}
                onChange={(event) =>
                  onSearchChange({
                    status:
                      event.target.value === "all" ? undefined : recipeStatus(event.target.value),
                  })
                }
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
              onClick={() => onSearchChange({ search: undefined, status: undefined })}
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
            {overview.isSuccess && !visible.length ? (
              <p className="empty-state">
                {t(overview.data.length ? "No recipe matches this filter." : "No recipes yet.")}
              </p>
            ) : null}
            {mode === "list" && visible.length ? (
              <>
                <details className="recipe-table-options">
                  <summary>{t("Table options")}</summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={showServings}
                      onChange={(event) => setShowServings(event.target.checked)}
                    />
                    {t("Desired servings")}
                  </label>
                </details>
                <div className="recipe-table-scroll">
                  <table className="recipe-overview-table">
                    <thead>
                      <tr>
                        {heading("name", t("Name"))}
                        {showServings ? heading("desired_servings", t("Desired servings")) : null}
                        {heading("due_score", t("Due score"))}
                        {features.enabled("STOCK")
                          ? heading("stock_status", t("Requirements fulfilled"))
                          : null}
                        {features.routeEnabled("/meal-plan") ? (
                          <th>
                            <span className="sr-only">{t("Actions")}</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((recipe) => (
                        <tr
                          key={recipe.id}
                          data-selected={highlighted === recipe.id || undefined}
                          onClick={(event) => {
                            if (
                              event.target instanceof Element &&
                              event.target.closest("a, button")
                            )
                              return;
                            open(recipe.id);
                          }}
                        >
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
                          {showServings ? (
                            <td className="num">{formatAmount(recipe.desired_servings)}</td>
                          ) : null}
                          <td className="num">{recipe.due_score ?? ""}</td>
                          {features.enabled("STOCK") ? <td>{badge(recipe)}</td> : null}
                          {features.routeEnabled("/meal-plan") ? (
                            <td className="recipe-plan-cell">
                              <RecipeMealPlanAction id={recipe.id} name={recipe.name} compact />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {mode === "gallery" ? (
              <ul className="recipe-gallery">
                {visible.map((recipe) => (
                  <li key={recipe.id} data-selected={highlighted === recipe.id || undefined}>
                    <Link
                      to="/recipes/$recipeId"
                      params={{ recipeId: String(recipe.id) }}
                      aria-label={recipe.name}
                      aria-current={highlighted === recipe.id ? "true" : undefined}
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
                      {features.enabled("STOCK") ? badge(recipe) : null}
                    </Link>
                    {features.routeEnabled("/meal-plan") ? (
                      <div className="recipe-gallery-actions">
                        <RecipeMealPlanAction id={recipe.id} name={recipe.name} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
        {recipesSideBySide && selected !== undefined ? (
          <RecipePreview key={selected} id={selected} focusOnLoad={search.recipe !== undefined} />
        ) : null}
      </div>
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
