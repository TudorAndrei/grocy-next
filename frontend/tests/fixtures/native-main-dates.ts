import { vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./native-editor";
import tamil from "./tamil-localization.json";
import { mealPlanCalendarFixture } from "./mealplan-calendar";

export type MainDateHost =
  | "chore"
  | "choretracking"
  | "batterytracking"
  | "reschedule"
  | "mealplan"
  | "recipes";

export function mountMainDate(
  host: MainDateHost,
  options: {
    dateOnly?: boolean;
    english?: boolean;
    config?: JsonObject;
    history?: boolean;
    strict?: boolean;
    localizedCopyRow?: boolean;
    localizedNext?: boolean;
  } = {},
) {
  const users = [{ id: 7, username: "owner", display_name: "Owner" }];

  const chore = {
    id: 1,
    name: "Water plants",
    description: null,
    active: 1,
    period_type: "daily",
    period_days: 1,
    period_interval: 1,
    period_config: "",
    assignment_type: "no-assignment",
    assignment_config: "",
    track_date_only: options.dateOnly ? 1 : 0,
    rollover: 0,
    consume_product_on_execution: 0,
    product_id: null,
    product_amount: null,
    userfields: null,
    next_execution_assigned_to_user_id: "7",
    rescheduled_date: null,
  };

  const battery = {
    id: 1,
    name: "Camera battery",
    description: null,
    used_in: "Camera",
    active: 1,
  };

  const details = {
    chore,
    last_tracked: null,
    tracked_count: 0,
    last_done_by: null,
    average_execution_frequency_hours: null,
    next_estimated_execution_time: options.localizedNext
      ? "௨௦௩௦-௦௫-௦௫ ௦௬:௦௭:௦௮"
      : "2030-05-05 06:07:08",
    next_execution_assigned_user: users[0],
  };

  const mealplan = mealPlanCalendarFixture();
  const copyRows = mealplan.events.map((event) => ({ ...event.entry }));

  // An additional literal TEXT day exists outside the ASCII calendar range.
  // Copy's native equality query must match this row without canonicalizing its request.
  if (options.localizedCopyRow) copyRows.push({ ...copyRows[0]!, id: 104, day: "௨௦௨௬-௧௧-௦௨" });
  const writes: { path: string; body: JsonObject }[] = [];
  const reads: string[] = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const route =
    host === "chore"
      ? "/chore/1?embedded"
      : host === "reschedule"
        ? "/choresoverview"
        : host === "mealplan"
          ? "/mealplan?start=2026-11-02"
          : `/${host}`;

  const app = mountNativeEditor(
    route,
    (path, request) => {
      if (!request?.method || request.method === "GET") reads.push(path);

      if (path.startsWith("/api/v2/localization"))
        return Response.json(
          options.english
            ? {
                ...tamil,
                locale: "en",
                catalog: {
                  domain: tamil.catalog.domain,
                  "plural-forms": null,
                  messages: { "": {} },
                },
              }
            : tamil,
        );

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/system/config")
        return Response.json({
          LOCALE: options.english ? "en" : "ta",
          FEATURE_FLAG_CHORES: true,
          FEATURE_FLAG_BATTERIES: true,
          FEATURE_FLAG_CHORES_ASSIGNMENTS: false,
          FEATURE_FLAG_STOCK: false,
          FEATURE_FLAG_SHOPPINGLIST: false,
          FEATURE_FLAG_LABEL_PRINTER: false,
          FEATURE_FLAG_RECIPES: true,
          FEATURE_FLAG_RECIPES_MEALPLAN: true,
          CALENDAR_FIRST_DAY_OF_WEEK: "1",
          CALENDAR_SHOW_WEEK_OF_YEAR: false,
          ...options.config,
        });

      if (path === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: true,
          CHORE_TRACK_EXECUTION: true,
          BATTERIES_TRACK_CHARGE_CYCLE: true,
        });

      if (path === "/api/user/settings") return Response.json({ stock_decimal_places_amounts: 2 });

      if (path === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          php_version: "",
          python_version: "3",
          sqlite_version: "3",
          db_version: 1,
          os: "test",
          client: "test",
        });

      if (
        path === "/api/objects/userfields" ||
        path === "/api/v2/custom-data/fields" ||
        (path.startsWith("/api/userfields/") && !request?.method)
      )
        return Response.json([]);

      if (path === "/api/objects/chores") return Response.json([chore]);

      if (path === "/api/objects/batteries") return Response.json([battery]);

      if (path === "/api/v2/chores/tracking/users") return Response.json(users);

      if (path === "/api/objects/chores/1" && !request?.method) return Response.json(chore);

      if (path === "/api/objects/batteries/1" && !request?.method) return Response.json(battery);

      if (path === "/api/chores/1" && !request?.method) return Response.json(details);

      if (path === "/api/batteries/1" && !request?.method)
        return Response.json({ battery, last_charged: null, charge_cycles_count: 0 });

      if (path === "/api/v2/chores/1/editor")
        return Response.json({
          chore,
          has_history: options.history ?? false,
          initial_start_date: "2020-01-02 03:04:00",
          users,
          products: [],
        });

      if (path === "/api/v2/chores/overview")
        return Response.json({
          rows: [
            {
              chore_id: 1,
              name: chore.name,
              track_date_only: chore.track_date_only,
              last_tracked_time: null,
              next_estimated_execution_time: details.next_estimated_execution_time,
              next_execution_assigned_to_user_id: 7,
              is_rescheduled: 0,
              is_reassigned: 0,
              period_type: "daily",
              due_type: "overdue",
              custom_values: {},
            },
          ],
          users,
          next_x_days: 5,
          current_user_id: 7,
        });

      if (path === "/api/chores")
        return Response.json(
          options.localizedNext
            ? [
                {
                  next_estimated_execution_time: details.next_estimated_execution_time,
                  next_execution_assigned_to_user_id: 7,
                },
              ]
            : [],
        );

      if (path === "/api/v2/chores/1/card")
        return Response.json({ ...details, description_html: "" });

      if (path.startsWith("/api/v2/meal-plan/calendar")) return Response.json(mealplan);

      if (path === "/api/objects/meal_plan_sections") return Response.json(mealplan.sections);

      if (path === "/api/objects/recipes/7") return Response.json(mealplan.recipes[0]);

      if (path === "/api/objects/recipes") return Response.json(mealplan.recipes);

      if (path === "/api/v2/recipes/overview")
        return Response.json([
          {
            id: 7,
            name: "Rice dinner",
            picture_file_name: null,
            desired_servings: 2,
            due_score: 0,
            missing_products_count: 0,
            product_names: "Rice",
            stock_status: "Xenoughinstock",
            custom_values: {},
          },
        ]);

      if (path.startsWith("/api/objects/meal_plan?query[]=day="))
        return Response.json(copyRows.filter((entry) => entry.day === path.split("day=")[1]));

      if (path === "/api/objects/meal_plan" && !request?.method) return Response.json(copyRows);

      if (request?.method === "POST" || request?.method === "PUT") {
        writes.push({ path, body: JSON.parse(String(request.body)) });

        return path.endsWith("/execute") || path.endsWith("/charge")
          ? Response.json({ id: 41 })
          : new Response(null, { status: 204 });
      }

      return undefined;
    },
    {},
    {},
    { strictMode: options.strict },
  );

  return { ...app, reads, writes, errors, messages };
}
