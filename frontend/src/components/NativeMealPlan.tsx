import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { useNativeDocumentReload } from "@/lib/native-document";
import type { JsonObject } from "@/lib/json";
import {
  getMealPlanCalendar,
  type MealPlanCalendar,
  type MealPlanEditorRequest,
  type MealPlanEntry,
} from "@/lib/mealplan-calendar";
import {
  initialMealPlanDate,
  initialMealPlanMode,
  mealPlanDateMatches,
  mealPlanEvents,
  mealPlanFirstDay,
  mealPlanLocation,
  mealPlanRange,
  renderedMealPlanEvent,
  type MealPlanMode,
} from "@/lib/mealplan-calendar-view";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { MealPlanEntryDialogs } from "./MealPlanEntryDialogs";
import { MealPlanEventCard } from "./MealPlanEventCard";
import { MealPlanDaySummary, MealPlanWeekSummary } from "./MealPlanSummary";

export function NativeMealPlan() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });
  const [request, setRequest] = useState({ search, version: 0 });
  const [observed, setObserved] = useState(search);
  const [written, setWritten] = useState<string>();
  const scope = useRef<AbortController>(undefined);
  const features = useFeatures();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  if (observed !== search) {
    setObserved(search);

    if (written === search) setWritten(undefined);
    else {
      setRequest((current) => ({ search, version: current.version + 1 }));
    }
  }

  const data = useQuery({
    queryKey: ["mealplan-calendar", request.search, request.version],
    queryFn: ({ signal }) => getMealPlanCalendar(request.search, signal),
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<{
    version: number;
    data: MealPlanCalendar;
    config: JsonObject;
  }>();

  if (
    initial?.version !== request.version &&
    data.isSuccess &&
    !data.isFetching &&
    settings.isSuccess &&
    !settings.isFetching &&
    features.query.isSuccess &&
    !features.query.isFetching
  )
    setInitial({ version: request.version, data: data.data, config: features.query.data });

  const current = initial?.version === request.version ? initial : undefined;
  const error = data.error ?? settings.error ?? features.query.error;
  const reloadDocument = useNativeDocumentReload("/mealplan");

  const register = useCallback((controller: AbortController) => {
    scope.current = controller;
  }, []);

  const replace = useCallback(
    (next: string) => {
      if (router.history.location.search === next) return;
      setWritten(next);
      void router.navigate({ href: `${router.state.location.pathname}${next}`, replace: true });
    },
    [router],
  );

  const reload = useCallback(async () => {
    scope.current?.abort();
    reloadDocument();
  }, [reloadDocument]);

  const move = useCallback(
    (next: string) => {
      scope.current?.abort();
      reloadDocument();
      replace(next);
    },
    [replace, reloadDocument],
  );

  if (current)
    return (
      <CalendarPage
        key={request.version}
        context={current.data}
        config={current.config}
        search={request.search}
        normalize={replace}
        onMove={move}
        onReload={reload}
        register={register}
      />
    );

  return (
    <>
      <PageHeader title={t("Meal plan")} />
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button type="button" className="btn" onClick={() => void reload()}>
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock label={t("Loading meal plan…")} />
      )}
    </>
  );
}

function CalendarPage({
  context,
  config,
  search,
  normalize,
  onMove,
  onReload,
  register,
}: {
  context: MealPlanCalendar;
  config: JsonObject;
  search: string;
  normalize: (search: string) => void;
  onMove: (search: string) => void;
  onReload: () => Promise<void>;
  register: (controller: AbortController) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [openedAt] = useState(() => new Date());
  const locale = t("moment_locale");
  const today = moment(openedAt).locale(locale).format("YYYY-MM-DD");
  const [desktop] = useState(() => document.documentElement.clientWidth >= 768);
  const [mode] = useState(() => initialMealPlanMode(search, document.documentElement.clientWidth));
  const [date] = useState(() => initialMealPlanDate(search, openedAt, locale));
  const firstDay = mealPlanFirstDay(config, openedAt, locale);
  const days = mealPlanRange(date, mode, firstDay);
  const [editor, setEditor] = useState<MealPlanEditorRequest | null>(null);
  const [menu, setMenu] = useState<string>();
  const nextDialog = useRef(0);
  const owner = useRef<AbortController>(undefined);
  const getSignal = useCallback(() => owner.current?.signal, []);

  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    register(controller);

    return () => {
      controller.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, [register]);

  const rangeStart = days[0]!.format("YYYY-MM-DD");

  const changeView = (target: moment.Moment, view: MealPlanMode) => {
    const start = mealPlanRange(target, view, firstDay)[0]!.format("YYYY-MM-DD");

    if (view === mode && start === rangeStart) return;
    onMove(mealPlanLocation(router.history.location.search, start, view));
  };

  useEffect(() => {
    if (!date.isValid()) return;
    normalize(mealPlanLocation(search, rangeStart, mode));
  }, [date, normalize, search, rangeStart, mode]);

  const resize = useEffectEvent(() => {
    const view = document.documentElement.clientWidth < 768 ? "day" : "week";

    if (view !== mode) changeView(date, view);
  });

  useEffect(() => {
    const listener = () => resize();
    window.addEventListener("resize", listener, { once: true });

    return () => window.removeEventListener("resize", listener);
  }, []);

  useEffect(() => {
    if (!menu) return;

    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".mealplan-day-actions"))
        setMenu(undefined);
    };

    document.addEventListener("click", dismiss);

    return () => document.removeEventListener("click", dismiss);
  }, [menu]);

  const open = (kind: MealPlanEditorRequest["kind"], day: string, entry?: MealPlanEntry) => {
    setMenu(undefined);
    nextDialog.current += 1;
    setEditor({ kind, day, entry, version: nextDialog.current });
  };

  const sections = context.used_sections.length
    ? context.used_sections
    : [
        {
          id: -1,
          name: null,
          sort_number: null,
          time_info: null,
        },
      ];

  if (!date.isValid())
    return (
      <>
        <PageHeader title={t("Meal plan")} />
        <ErrorBlock message={t("Invalid date")} />
      </>
    );

  const dateLabel =
    mode === "day" ? date.format("LL") : `${days[0]!.format("LL")} – ${days.at(-1)!.format("LL")}`;

  return (
    <div className="native-mealplan">
      <PageHeader
        title={t("Meal plan")}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              {t("Print")}
            </button>
            <Link className="btn btn-ghost" to="/mealplansections">
              {t("Configure sections")}
            </Link>
          </>
        }
      />
      <div className="native-mealplan-toolbar">
        <h2>{dateLabel}</h2>
        <MealPlanWeekSummary context={context} onReload={onReload} getSignal={getSignal} />
        <div className="actions mealplan-actions">
          {desktop ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={mode === "week"}
                onClick={() => changeView(date, "week")}
              >
                {t("Week")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                aria-pressed={mode === "day"}
                onClick={() => changeView(date, "day")}
              >
                {t("Day")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              changeView(days[0]!.clone().subtract(mode === "day" ? 1 : 7, "days"), mode)
            }
          >
            {t(mode === "day" ? "Previous day" : "Previous week")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={days.some((day) => day.format("YYYY-MM-DD") === today)}
            onClick={() => changeView(moment().locale(locale), mode)}
          >
            {t("Today")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => changeView(days[0]!.clone().add(mode === "day" ? 1 : 7, "days"), mode)}
          >
            {t(mode === "day" ? "Next day" : "Next week")}
          </button>
        </div>
      </div>
      {sections.map((section, index) => (
        <section key={section.id} className="native-mealplan-section" data-section-id={section.id}>
          {section.name ? (
            <h3>
              {section.name}
              {section.time_info ? <small>{section.time_info}</small> : null}
            </h3>
          ) : null}
          <div className="native-mealplan-scroll">
            <table
              className="native-mealplan-calendar"
              aria-label={section.name || t("Meal plan")}
              data-mode={mode}
            >
              <thead>
                <tr>
                  {days.map((day) => {
                    const key = day.format("YYYY-MM-DD");

                    const hasEvent = context.events.some(
                      (event) =>
                        mealPlanDateMatches(event.start, key, locale) &&
                        renderedMealPlanEvent(event, context) &&
                        sections.some(
                          (candidate) =>
                            event.entry.section_id !== null &&
                            String(event.entry.section_id) === String(candidate.id),
                        ),
                    );

                    return (
                      <th key={key} scope="col" data-date={key} aria-label={day.format("dddd, LL")}>
                        <time dateTime={key}>
                          {day.format(mode === "day" ? "dddd" : "ddd M/D")}
                        </time>
                        {index === 0 ? (
                          <>
                            <div
                              className="mealplan-actions mealplan-day-actions"
                              onKeyDown={(event) => {
                                if (event.key !== "Escape") return;
                                event.preventDefault();
                                event.stopPropagation();
                                setMenu(undefined);
                                event.currentTarget
                                  .querySelector<HTMLButtonElement>("[data-more]")
                                  ?.focus();
                              }}
                            >
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => open("recipe", key)}
                              >
                                {t("Add recipe")}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                aria-label={t("More actions")}
                                data-more
                                aria-expanded={menu === key}
                                onClick={() => setMenu(menu === key ? undefined : key)}
                              >
                                {t("More")}
                              </button>
                              {menu === key ? (
                                <div className="mealplan-day-menu">
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => open("note", key)}
                                  >
                                    {t("Add note")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => open("product", key)}
                                  >
                                    {t("Add product")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => open("copy", key)}
                                  >
                                    {t("Copy this day")}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            {hasEvent ? <MealPlanDaySummary context={context} day={key} /> : null}
                          </>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {days.map((day) => {
                    const key = day.format("YYYY-MM-DD");

                    return (
                      <td key={key} data-date={key} data-today={key === today || undefined}>
                        {mealPlanEvents(context.events, key, section.id, locale).map((event) =>
                          event.type === "recipe" ||
                          event.type === "product" ||
                          event.type === "note" ? (
                            <MealPlanEventCard
                              key={event.id}
                              context={context}
                              event={event}
                              onEdit={(entry) => {
                                if (
                                  entry.type === "recipe" ||
                                  entry.type === "product" ||
                                  entry.type === "note"
                                )
                                  open(entry.type, entry.day, entry);
                              }}
                              onReload={onReload}
                              getSignal={getSignal}
                            />
                          ) : (
                            <div key={event.id} className="mealplan-event-card">
                              {event.title}
                            </div>
                          ),
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <MealPlanEntryDialogs
        context={context}
        request={editor}
        onClose={() => setEditor(null)}
        onReload={onReload}
        getSignal={getSignal}
      />
    </div>
  );
}
