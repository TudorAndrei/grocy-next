import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { EntityRow } from "@/lib/entities";
import type { ProductSummary, Recipe } from "@/lib/types";
import { objectsQuery, productsQuery, recipesQuery } from "@/hooks/queries";

export const Route = createFileRoute("/meal-plan")({ component: MealPlanPage });

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + offset);

  return monday;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
}

function mealLabel(
  row: EntityRow,
  recipes: Recipe[] | undefined,
  products: ProductSummary[] | undefined,
): string {
  if (row.type === "recipe") {
    const recipe = recipes?.find((r) => r.id === row.recipe_id);

    return recipe?.name ?? `Recipe #${row.recipe_id ?? "?"}`;
  }

  if (row.type === "product") {
    const product = products?.find((p) => p.id === row.product_id);

    return product?.name ?? `Product #${row.product_id ?? "?"}`;
  }

  return String(row.note ?? "Note");
}

function MealPlanPage() {
  const client = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const meals = useQuery(objectsQuery("meal_plan"));
  const sections = useQuery(objectsQuery("meal_plan_sections"));
  const recipes = useQuery(recipesQuery());
  const products = useQuery(productsQuery());

  const action = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: string }) =>
      api.action(`/api/v2/meal-plan/${id}/${kind}`, kind === "shopping-list" ? {} : undefined),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });

  const days = useMemo(
    () =>
      WEEKDAY_LABELS.map((label, index) => {
        const date = addDays(weekStart, index);

        return { label, date, key: toDateKey(date) };
      }),
    [weekStart],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, EntityRow[]>();

    for (const day of days) map.set(day.key, []);

    for (const row of meals.data ?? []) {
      const key = String(row.day ?? "").slice(0, 10);
      const list = map.get(key);

      if (!list) continue;
      list.push(row);
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        const sectionA = sections.data?.find((s) => s.id === a.section_id)?.sort_number ?? 0;

        const sectionB = sections.data?.find((s) => s.id === b.section_id)?.sort_number ?? 0;

        return Number(sectionA) - Number(sectionB) || a.id - b.id;
      });
    }

    return map;
  }, [meals.data, days, sections.data]);

  const [todayKey] = useState(() => toDateKey(new Date()));
  const weekLabel = `${days[0].key} – ${days[6].key}`;

  const loading = meals.isLoading || sections.isLoading || recipes.isLoading || products.isLoading;

  const error = meals.error || sections.error || recipes.error || products.error || action.error;

  const sectionName = (id: EntityRow["section_id"]) =>
    sections.data?.find((s) => s.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Meal plan"
        lead="Plan the week by day. Complete meals or add missing ingredients to your shopping list."
      />
      {error ? <ErrorBlock message={error.message} /> : null}
      <div className="toolbar">
        <div className="actions" style={{ margin: 0 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            Previous week
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            This week
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            Next week
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {weekLabel}
        </p>
      </div>
      {loading ? <LoadingBlock label="Loading meal plan…" /> : null}
      {!loading ? (
        <div className="meal-week" role="list">
          {days.map((day) => {
            const entries = byDay.get(day.key) ?? [];

            return (
              <section
                key={day.key}
                className="meal-day"
                data-today={day.key === todayKey ? "true" : "false"}
                role="listitem"
              >
                <header className="meal-day-header">
                  <strong>{day.label}</strong>
                  <span className="muted">{day.key.slice(5)}</span>
                </header>
                {entries.length === 0 ? (
                  <p className="muted meal-day-empty">No meals</p>
                ) : (
                  <ul className="meal-day-list">
                    {entries.map((row) => {
                      const section = sectionName(row.section_id);

                      return (
                        <li key={row.id} className="meal-entry">
                          <div>
                            {section ? (
                              <p className="muted meal-entry-section">{String(section)}</p>
                            ) : null}
                            <p className={row.done ? "completed" : undefined}>
                              {mealLabel(row, recipes.data, products.data)}
                            </p>
                            <p className="muted">
                              {String(row.type)}
                              {row.type === "recipe" && row.recipe_servings
                                ? ` · ${row.recipe_servings} servings`
                                : ""}
                              {row.type === "product" && row.product_amount
                                ? ` · ${row.product_amount}`
                                : ""}
                            </p>
                          </div>
                          <div className="actions" style={{ margin: 0 }}>
                            {!row.done ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={action.isPending}
                                onClick={() =>
                                  action.mutate({
                                    id: row.id,
                                    kind: "consume",
                                  })
                                }
                              >
                                Complete
                              </button>
                            ) : null}
                            {row.type === "recipe" ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={action.isPending}
                                onClick={() =>
                                  action.mutate({
                                    id: row.id,
                                    kind: "shopping-list",
                                  })
                                }
                              >
                                Shopping list
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      <EntityManager
        entity="meal_plan"
        title="All meals"
        actions={(row) => (
          <>
            {!row.done && (
              <button
                className="btn btn-primary"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: row.id, kind: "consume" })}
              >
                Complete meal
              </button>
            )}
            {row.type === "recipe" && (
              <button
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: row.id, kind: "shopping-list" })}
              >
                Add missing ingredients
              </button>
            )}
          </>
        )}
      />
    </>
  );
}
