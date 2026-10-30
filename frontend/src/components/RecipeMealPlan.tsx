import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { useModalDialog } from "@/hooks/useModalDialog";
import { CameraScanner } from "./CameraScanner";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

const MealPlanContext = createContext<((id: number) => void) | null>(null);

export function RecipeMealPlanProvider({ children }: { children: ReactNode }) {
  const [recipeId, setRecipeId] = useState<number>();
  const [servings, setServings] = useState("1");
  const [section, setSection] = useState<string>();
  const features = useFeatures();

  return (
    <MealPlanContext.Provider value={setRecipeId}>
      {children}
      {recipeId !== undefined && features.routeEnabled("/meal-plan") ? (
        <RecipeMealPlanDialog
          recipeId={recipeId}
          servings={servings}
          onServingsChange={setServings}
          section={section}
          onSectionChange={setSection}
          onClose={() => setRecipeId(undefined)}
        />
      ) : null}
    </MealPlanContext.Provider>
  );
}

export function RecipeMealPlanAction({
  id,
  name,
  compact = false,
}: {
  id: number;
  name: string;
  compact?: boolean;
}) {
  const open = useContext(MealPlanContext);
  const features = useFeatures();
  const { t } = useI18n();

  if (!open || !features.routeEnabled("/meal-plan")) return null;

  return (
    <button
      type="button"
      className={compact ? "btn btn-ghost btn-sm" : "btn btn-ghost"}
      aria-label={compact ? t("Add %s to meal plan", name) : undefined}
      title={compact ? t("Add to meal plan") : undefined}
      onClick={() => open(id)}
    >
      {compact ? <Icon name="calendar" /> : t("Add to meal plan")}
    </button>
  );
}

function RecipeMealPlanDialog({
  recipeId,
  servings,
  onServingsChange,
  section,
  onSectionChange,
  onClose,
}: {
  recipeId: number;
  servings: string;
  onServingsChange: (value: string) => void;
  section: string | undefined;
  onSectionChange: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { amountPrecision } = usePreferences();
  const notify = useNotify();
  const client = useQueryClient();
  const recipes = useQuery({ queryKey: queryKeys.recipeOverview, queryFn: api.getRecipeOverview });

  const sections = useQuery({
    queryKey: [...queryKeys.objects("meal_plan_sections"), "ordered"],
    queryFn: api.getMealPlanSections,
  });

  const [recipe, setRecipe] = useState(String(recipeId));

  const [day, setDay] = useState(() => {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  const dialog = useModalDialog();
  const servingInput = useRef<HTMLInputElement>(null);
  const prefix = useId();
  const sectionId = section ?? String(sections.data?.[0]?.id ?? "");
  const loading = recipes.isPending || sections.isPending;
  const error = recipes.error ?? sections.error;
  const step = amountPrecision > 0 ? `0.${"0".repeat(amountPrecision - 1)}1` : "1";

  const save = useMutation({
    mutationFn: () =>
      api.createObject("meal_plan", {
        day,
        recipe_id: recipe,
        recipe_servings: servings,
        section_id: sectionId,
        type: "recipe",
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      notify({ message: t("Successfully added the recipe to the meal plan") });
      onClose();
    },
  });

  useEffect(() => {
    if (!loading && !error) servingInput.current?.focus();
  }, [loading, error]);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog recipe-plan-dialog"
      aria-labelledby={`${prefix}-title`}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={`${prefix}-title`}>{t("Add meal plan entry")}</h2>
      {loading ? <LoadingBlock /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            onClick={() => void Promise.all([recipes.refetch(), sections.refetch()])}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {save.error ? <ErrorBlock message={save.error.message} /> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset className="recipe-plan-fields" disabled={loading || !!error || save.isPending}>
          <label className="field">
            <span>{t("Day")}</span>
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{t("Recipe")}</span>
            <select value={recipe} onChange={(event) => setRecipe(event.target.value)} required>
              <option value="">{t("Select a recipe")}</option>
              {recipes.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <CameraScanner
            onScan={(code) => {
              const parts = code.split(":");
              const id = code.startsWith("grcy") && parts[1] === "r" ? parts[2] : undefined;
              const match = recipes.data?.find((item) => String(item.id) === id);
              setRecipe(match ? String(match.id) : "");
              servingInput.current?.focus();
            }}
          />
          <label className="field">
            <span>{t("Servings")}</span>
            <input
              ref={servingInput}
              type="number"
              value={servings}
              min={step}
              step={step}
              required
              onChange={(event) => onServingsChange(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("Section")}</span>
            <select
              value={sectionId}
              onChange={(event) => onSectionChange(event.target.value)}
              required
            >
              <option value="">{t("Select a section")}</option>
              {sections.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="recipe-action-buttons">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !!error || save.isPending}
          >
            {t(save.isPending ? "Saving…" : "Save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
