import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import moment from "moment/min/moment-with-locales.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys, request } from "@/lib/api";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { useModalDialog } from "@/hooks/useModalDialog";
import { NativeMainDateInput } from "./NativeMainDateInput";
import { RecipePicker } from "./RecipePicker";
import { CameraScanner } from "./CameraScanner";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

type Opening = { id: number; mode: "native-table" | "additional" };

type MealPlanSubmission = {
  day: string;
  recipe_id: string;
  recipe_servings: string;
  section_id: string;
  type: "recipe";
};

const MealPlanContext = createContext<((opening: Opening) => void) | null>(null);

export function RecipeMealPlanProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening>();
  const [nativePresentation, setNativePresentation] = useState<{ id: number; revision: number }>();
  const startup = useRef(true);

  useEffect(() => {
    // Native FormFocusDelay applies only during the first second of this document.
    const timer = window.setTimeout(() => {
      startup.current = false;
    }, 1000);

    return () => window.clearTimeout(timer);
  }, []);
  const tasks = useDocumentTasks();
  const client = useQueryClient();
  const notify = useNotify();
  const { t } = useI18n();
  const [servings, setServings] = useState("1");
  const [section, setSection] = useState<string>();

  const saveNative = async (body: MealPlanSubmission) => {
    // This static native modal belongs to the document, rather than one opening.
    const task = tasks.capture();

    try {
      await request("/api/objects/meal_plan", {
        method: "POST",
        body: JSON.stringify(body),
        signal: task.signal,
      });
    } catch (error) {
      task.genericError(
        "Error while saving, probably this item already exists",
        error instanceof Error ? error : undefined,
      );

      return;
    } finally {
      // The server may have committed a dispatched write before document retirement.
      for (const key of [
        ["meal-plan"],
        ["mealplan-calendar"],
        ["objects", "meal_plan"],
        ["entity-manager", "meal_plan"],
        ["recipes"],
        ["recipe-view"],
        ["recipe-overview"],
      ])
        void client.invalidateQueries({ queryKey: key, refetchType: "none" });
    }

    if (task.signal.aborted) return;
    notify({ message: t("Successfully added the recipe to the meal plan") });
    // Additional reader/gallery dialogs are a separate workflow. An old native
    // success hides a reopened native modal, but does not dismiss an additional one.
    setOpening((current) => (current?.mode === "native-table" ? undefined : current));
  };

  const open = (next: Opening) => {
    if (next.mode === "native-table")
      setNativePresentation((current) => ({ id: next.id, revision: (current?.revision ?? 0) + 1 }));
    setOpening(next);
  };

  return (
    <MealPlanContext.Provider value={open}>
      {children}
      {nativePresentation ? (
        <RecipeMealPlanDialog
          recipeId={nativePresentation.id}
          native
          visible={opening?.mode === "native-table"}
          openingRevision={nativePresentation.revision}
          scanDelay={() => (startup.current ? 500 : 0)}
          onNativeSave={(body) => void saveNative(body)}
          servings={servings}
          onServingsChange={setServings}
          section={section}
          onSectionChange={setSection}
          onClose={() => setOpening(undefined)}
        />
      ) : null}
      {opening?.mode === "additional" ? (
        <RecipeMealPlanDialog
          key={`additional:${opening.id}`}
          recipeId={opening.id}
          native={false}
          visible
          servings={servings}
          onServingsChange={setServings}
          section={section}
          onSectionChange={setSection}
          onClose={() => setOpening(undefined)}
        />
      ) : null}
    </MealPlanContext.Provider>
  );
}

export function RecipeMealPlanAction({
  id,
  name,
  compact = false,
  nativeMenuItem = false,
}: {
  id: number;
  name: string;
  compact?: boolean;
  nativeMenuItem?: boolean;
}) {
  const open = useContext(MealPlanContext);
  const features = useFeatures();
  const { t } = useI18n();

  if (!open || (!nativeMenuItem && !features.routeEnabled("/meal-plan"))) return null;

  return (
    <button
      type="button"
      className={compact && !nativeMenuItem ? "btn btn-ghost btn-sm" : "btn btn-ghost"}
      role={nativeMenuItem ? "menuitem" : undefined}
      aria-label={compact && !nativeMenuItem ? t("Add %s to meal plan", name) : undefined}
      title={compact && !nativeMenuItem ? t("Add to meal plan") : undefined}
      onClick={() => open({ id, mode: nativeMenuItem ? "native-table" : "additional" })}
    >
      {compact && !nativeMenuItem ? <Icon name="calendar" /> : t("Add to meal plan")}
    </button>
  );
}

function RecipeMealPlanDialog({
  recipeId,
  native,
  visible,
  openingRevision = 0,
  scanDelay,
  onNativeSave,
  servings,
  onServingsChange,
  section,
  onSectionChange,
  onClose,
}: {
  recipeId: number;
  native: boolean;
  visible: boolean;
  openingRevision?: number;
  scanDelay?: () => number;
  onNativeSave?: (body: MealPlanSubmission) => void;
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
  const [recipeText, setRecipeText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateInitialization, setDateInitialization] = useState({ revision: 0, cached: "" });
  const initialized = useRef<number>(undefined);
  const dateInput = useRef<HTMLInputElement>(null);

  const [day, setDay] = useState(() => {
    if (native) return "";
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  const dialog = useModalDialog(visible);
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

  const locked = !native && save.isPending;

  useLayoutEffect(() => {
    if (!native || !visible || !recipes.isSuccess || initialized.current === openingRevision)
      return;
    initialized.current = openingRevision;
    // Init(true) first parses the PREVIOUS visible text; SetValue(today) then
    // changes the text without committing it to the re-created date widget.
    const previous = dateInput.current?.value ?? "";
    const translatedLocale = t("moment_locale");
    const locale = moment.locales().includes(translatedLocale) ? translatedLocale : "en";
    const accepted = moment(previous, "YYYY-MM-DD", locale, false);

    const cached =
      accepted.isValid() && !accepted.isAfter(moment("2999-12-31 23:59:59"))
        ? accepted.format("YYYY-MM-DD")
        : "";

    setDateInitialization({ revision: openingRevision, cached });
    setDay(moment().locale(locale).format("YYYY-MM-DD"));
    setRecipe(String(recipeId));
    setRecipeText(recipes.data.find((item) => item.id === recipeId)?.name ?? "");
  }, [native, visible, openingRevision, recipes.isSuccess, recipes.data, recipeId, t]);

  useEffect(() => {
    if (visible && !loading && !error) servingInput.current?.focus();
  }, [visible, openingRevision, loading, error]);

  const submitNative = (form: HTMLFormElement) => {
    if (!form.reportValidity() || document.querySelector(".combobox-menu-visible")) return;
    onNativeSave?.({
      day: dateInput.current?.value ?? day,
      recipe_id: recipe,
      recipe_servings: servings,
      section_id: sectionId,
      type: "recipe",
    });
  };

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
      {!native && save.error ? <ErrorBlock message={save.error.message} /> : null}
      <form
        onKeyDown={(event) => {
          if (native && event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            submitNative(event.currentTarget);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();

          if (native) submitNative(event.currentTarget);
          else save.mutate();
        }}
      >
        <fieldset className="recipe-plan-fields" disabled={loading || !!error || locked}>
          {native ? (
            <>
              <div className="field">
                <NativeMainDateInput
                  key={dateInitialization.revision}
                  id={`${prefix}-day`}
                  caption={t("Day")}
                  datetime={false}
                  syncValue="set"
                  initializeFromValue
                  value={day}
                  inputRef={dateInput}
                  onChange={setDay}
                  initialValue={dateInitialization.cached}
                  required
                />
              </div>
              <RecipePicker
                recipes={recipes.data ?? []}
                value={recipe}
                text={recipeText}
                open={pickerOpen}
                disabled={loading || !!error}
                required
                hint=""
                nativeMealPlan
                scanDelay={scanDelay}
                onOpenChange={setPickerOpen}
                onChange={(id, text) => {
                  setRecipe(id);
                  setRecipeText(text);
                }}
              />
            </>
          ) : (
            <>
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
            </>
          )}
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
              {!native ? <option value="">{t("Select a section")}</option> : null}
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
          <button type="submit" className="btn btn-primary" disabled={loading || !!error || locked}>
            {t(locked ? "Saving…" : "Save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
