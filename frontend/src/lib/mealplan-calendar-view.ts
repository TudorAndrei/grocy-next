import moment from "moment/min/moment-with-locales.js";
import type { JsonObject } from "./json";
import { nativeQueryParameter } from "./native-query-flag";
import type { MealPlanCalendar, MealPlanEvent } from "./mealplan-calendar";

export type MealPlanMode = "week" | "day";

export function initialMealPlanMode(search: string, width: number): MealPlanMode {
  return width < 768 || nativeQueryParameter(search, "days") === "0" ? "day" : "week";
}

export function initialMealPlanDate(search: string, now: Date, locale: string) {
  const raw = nativeQueryParameter(search, "start");

  // FullCalendar reparses its locale-formatted start query in the same locale.
  return (raw === undefined ? moment(now) : moment.parseZone(String(raw), undefined, locale))
    .locale(locale)
    .startOf("day");
}

export function mealPlanFirstDay(config: JsonObject, now: Date, locale: string) {
  const calendar = String(config.CALENDAR_FIRST_DAY_OF_WEEK ?? "");
  const meal = String(config.MEAL_PLAN_FIRST_DAY_OF_WEEK ?? "");
  const selected = meal || calendar;
  const parsed = Number.parseInt(selected, 10);

  if (meal && parsed === -1) return now.getDay();

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
    ? parsed
    : moment.localeData(locale).firstDayOfWeek();
}

export function mealPlanRange(date: moment.Moment, mode: MealPlanMode, firstDay: number) {
  const start = date.clone().startOf("day");

  if (mode === "week") start.subtract((start.day() - firstDay + 7) % 7, "days");

  return Array.from({ length: mode === "day" ? 1 : 7 }, (_, index) =>
    start.clone().add(index, "days"),
  );
}

export function mealPlanLocation(search: string, start: string, mode: MealPlanMode) {
  const parameters = new URLSearchParams(search);
  parameters.set("start", start);

  if (mode === "day") parameters.set("days", "0");
  else parameters.delete("days");

  return `?${decodeURIComponent(parameters.toString())}`;
}

/** FullCalendar places date-only events by calendar date, independent of localized digits. */
export function mealPlanDateMatches(value: string, day: string, locale: string) {
  const eventDate = moment.parseZone(value, undefined, locale);
  const target = moment.parseZone(day, undefined, locale);

  return (
    eventDate.isValid() &&
    target.isValid() &&
    eventDate.year() === target.year() &&
    eventDate.month() === target.month() &&
    eventDate.date() === target.date()
  );
}

export function mealPlanEvents(
  events: MealPlanEvent[],
  day: string,
  sectionId: number,
  locale: string,
) {
  return events
    .filter(
      (event) =>
        mealPlanDateMatches(event.start, day, locale) &&
        event.entry.section_id !== null &&
        String(event.entry.section_id) === String(sectionId),
    )
    .sort((left, right) => (left.title ?? "").localeCompare(right.title ?? ""));
}

export function renderedMealPlanEvent(event: MealPlanEvent, context: MealPlanCalendar) {
  if (event.type === "recipe") {
    const shadow = context.internal_recipes.find(
      (recipe) => recipe.name === `${event.entry.day}#${event.entry.id}`,
    );

    return (
      event.recipe !== null &&
      shadow !== undefined &&
      context.recipes_resolved.some((recipe) => recipe.recipe_id === shadow.id)
    );
  }

  if (event.type === "product") return event.product_details !== null;

  return true;
}
