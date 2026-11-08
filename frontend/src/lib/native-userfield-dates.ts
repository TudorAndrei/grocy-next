import { useImperativeHandle, useLayoutEffect, useRef, type Ref, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useI18n } from "./i18n";
import { queryKeys } from "./api";
import type { JsonObject, JsonValue } from "./json";
import { createIcon, type IconName } from "@/components/Icon";
import { useNativeScriptBindings } from "./native-script-bindings";
import {
  createJQuery,
  createMoment,
  installBootstrap,
  installTempus,
  installDateTimePicker2,
  installDateTimePicker1,
  type NativeDateTimeHandle,
  type JQuery,
  type GrocyDateHost,
} from "../../public/vendor/native-userfield-date/runtime.js";
import "@/styles/native-userfield-dates.css";

const clock = createMoment();

function dateLocale(locale: string) {
  return clock.locales().includes(locale) ? locale : "en";
}

export function nativeUserfieldDateNow(locale: string, type: "date" | "datetime") {
  return clock()
    .locale(dateLocale(locale))
    .format(type === "date" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
}

export function nativeMainDateFormat(value: string | Date, locale: string, datetime: boolean) {
  return clock(value, undefined, dateLocale(locale)).format(
    datetime ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD",
  );
}

export type { NativeDateTimeHandle };

type Change = (value: string, dirty: boolean, event?: string) => void;

type Registration = { input: HTMLInputElement; change: Change; family: 1 | 2 };

type Scope = {
  register: (registration: Registration) => () => void;
  api: (family: 1 | 2) => NativeDateTimeHandle | undefined;
  synchronize: (family: 1 | 2) => void;
};

const scopes = new WeakMap<HTMLElement, Scope>();

function createScope(
  root: HTMLElement,
  locale: string,
  weekNumbers: boolean,
  firstDayOfWeek: JsonValue | undefined,
  translate: (message: string) => string,
  publishClearValue: () => void,
): Scope {
  const $ = createJQuery(window);
  const moment = createMoment();
  moment.locale(dateLocale(locale));

  // The source layout emits this configuration into a quoted JavaScript string.
  const firstDay =
    firstDayOfWeek == null || firstDayOfWeek === false
      ? ""
      : firstDayOfWeek === true
        ? "1"
        : String(firstDayOfWeek);

  if (firstDay)
    moment.updateLocale(moment.locale(), { week: { dow: Number.parseInt(firstDay, 10) } });
  installBootstrap($, window, document);
  // Bootstrap's unrelated document data APIs must never observe another React document.
  $(document).off();
  $(window).off();
  installTempus($, moment, window, root);
  $.fn.hasAttr = function (name) {
    return this.attr(name) !== undefined;
  };

  const scoped: JQuery = Object.assign(
    (selector?: Parameters<JQuery>[0]) => {
      const text = z.string().safeParse(selector);

      return text.success
        ? text.data === "#datetimepicker2-timeago"
          ? $(root).find("[data-native-date-context='2']").first()
          : text.data === "#datetimepicker-timeago"
            ? $(root).find("[data-native-date-context='1']").first()
            : text.data === "#datetimepicker-shortcut"
              ? $(root).find("[data-native-date-shortcut='1']").first()
              : text.data === "#datetimepicker-earlier-than-info"
                ? $(root).find("[data-native-date-earlier='1']").first()
                : $(root).find(text.data)
        : $(selector);
    },
    { fn: $.fn, isNumeric: $.isNumeric },
  );

  const registrations = new Map<HTMLInputElement, { change: Change; family: 1 | 2 }>();
  const host: GrocyDateHost = { Components: {}, CalendarShowWeekNumbers: weekNumbers };
  const ownedClass = !root.classList.contains("native-userfield-dates");
  root.classList.add("native-userfield-dates");
  const initialized = new Map<1 | 2, HTMLInputElement[]>();

  function synchronize(dirty: boolean) {
    for (const [input, registration] of registrations) registration.change(input.value, dirty);
  }

  function refreshContext(selector = ".datetimepicker2-wrapper") {
    const family = selector === ".datetimepicker-wrapper" ? "1" : "2";
    const context = root.querySelector<HTMLTimeElement>(`[data-native-date-context='${family}']`);

    if (!context) return;
    const source = context.getAttribute("datetime") ?? "";

    if (source.length < 10) {
      context.textContent = "";

      return;
    }

    const date = moment(source);
    context.textContent =
      !date.isValid() || source.startsWith("2999-12-31") || source.startsWith("2888-12-31")
        ? ""
        : source.slice(0, 10) === moment().format("YYYY-MM-DD")
          ? translate("Today")
          : date.fromNow();
  }

  function describePopup(picker: HTMLElement, open: boolean) {
    const button = picker.querySelector("[data-toggle='datetimepicker']");
    const popup = picker.querySelector<HTMLElement>(".bootstrap-datetimepicker-widget");
    button?.setAttribute("aria-expanded", String(open && Boolean(popup)));

    if (!popup) return;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", picker.getAttribute("data-calendar-label") ?? "Calendar");

    for (const action of popup.querySelectorAll<HTMLElement>("[data-action]")) {
      action.setAttribute("role", "button");
      action.tabIndex = action.classList.contains("disabled") ? -1 : 0;

      const title =
        action.getAttribute("title") ?? action.querySelector("[title]")?.getAttribute("title");

      const day = action.getAttribute("data-day");

      if (title) action.setAttribute("aria-label", title);
      else if (day) action.setAttribute("aria-label", moment(day, "L", true).format("LL"));
      action.setAttribute("aria-disabled", String(action.classList.contains("disabled")));
    }

    const icons: Array<[string, IconName]> = [
      ["fa-clock", "clock"],
      ["fa-calendar", "calendar"],
      ["fa-calendar-day", "today"],
      ["fa-arrow-up", "up"],
      ["fa-arrow-down", "down"],
      ["fa-chevron-left", "back"],
      ["fa-chevron-right", "back"],
      ["fa-check", "check"],
    ];

    for (const [className, name] of icons) {
      for (const target of popup.querySelectorAll(`.${className}`)) {
        if (target.querySelector("svg")) continue;
        const icon = createIcon(name);

        if (className === "fa-chevron-right") icon.style.rotate = "180deg";
        target.append(icon);
      }
    }
  }

  function keyAction(event: KeyboardEvent) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>(".bootstrap-datetimepicker-widget [data-action]");

    if (!action || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    action.click();
  }

  root.addEventListener("keydown", keyAction);

  function refresh() {
    for (const family of [1, 2] as const) {
      const selector = family === 1 ? ".datetimepicker" : ".datetimepicker2";

      const inputs = Array.from(
        root.querySelectorAll<HTMLInputElement>(`${selector} input:not(.form-check-input)`),
      );

      const previous = initialized.get(family) ?? [];

      if (
        !inputs.length ||
        (inputs.length === previous.length && inputs.every((input, i) => previous[i] === input))
      )
        continue;
      initialized.set(family, inputs);

      for (const input of inputs) $(input).off();

      for (const picker of root.querySelectorAll<HTMLElement>(selector)) $(picker).off();

      if (family === 1) scoped("#datetimepicker-shortcut").off();

      if (family === 1)
        installDateTimePicker1(scoped, moment, host, refreshContext, publishClearValue);
      else installDateTimePicker2(scoped, moment, host, refreshContext, publishClearValue);

      for (const input of inputs) {
        $(input).on("input change keyup paste", (event) => {
          registrations.get(input)?.change(input.value, event.type !== "input", event.type);
        });
      }

      for (const picker of root.querySelectorAll<HTMLElement>(selector)) {
        $(picker).on("show.datetimepicker update.datetimepicker", () =>
          describePopup(picker, true),
        );
        $(picker).on("hide.datetimepicker", () => describePopup(picker, false));
      }
    }

    synchronize(false);
  }

  function destroy() {
    // Widget destroy hides an open popup; detach callbacks before that can dirty a retired draft.
    for (const input of root.querySelectorAll<HTMLInputElement>(
      ".datetimepicker2 input, .datetimepicker input",
    ))
      $(input).off();

    for (const picker of root.querySelectorAll<HTMLElement>(".datetimepicker2, .datetimepicker")) {
      $(picker).off();

      if ($(picker).data("datetimepicker")) $(picker).datetimepicker("destroy");
    }

    $(root).off();
    scoped("#datetimepicker-shortcut").off();
    $(document).off();
    $(window).off();
    root.removeEventListener("keydown", keyAction);

    if (ownedClass) root.classList.remove("native-userfield-dates");
    scopes.delete(root);
  }

  return {
    api: (family) =>
      family === 1 ? host.Components.DateTimePicker : host.Components.DateTimePicker2,
    synchronize: (family) => {
      for (const [input, registration] of registrations)
        if (registration.family === family) registration.change(input.value, false);
    },
    register: ({ input, change, family }) => {
      registrations.set(input, { change, family });
      refresh();
      change(input.value, false);

      return () => {
        registrations.delete(input);

        if (!registrations.size) destroy();
        else {
          // A conditional purchased-date participant can leave while custom controls remain.
          $(input).off();
          const picker = input.closest<HTMLElement>(".datetimepicker2, .datetimepicker");

          if (picker) {
            $(picker).off();

            if ($(picker).data("datetimepicker")) $(picker).datetimepicker("destroy");
          }

          initialized.set(
            family,
            (initialized.get(family) ?? []).filter((element) => element !== input),
          );

          if (
            family === 1 &&
            !Array.from(registrations.values()).some((registration) => registration.family === 1)
          )
            scoped("#datetimepicker-shortcut").off();
        }
      };
    },
  };
}

/** One native DateTimePicker2 collection belongs to its form, including its main purchased date. */
export function useNativeDateTimeInput(
  input: RefObject<HTMLInputElement | null>,
  change: Change,
  family: 1 | 2 = 2,
  ref?: Ref<NativeDateTimeHandle>,
) {
  const current = useRef(change);
  const owner = useRef<Scope | undefined>(undefined);
  const scripts = useNativeScriptBindings();
  const { t } = useI18n();
  const client = useQueryClient();
  const locale = t("moment_locale");
  const config = client.getQueryData<JsonObject>(queryKeys.systemConfig);
  const weekSetting = config?.CALENDAR_SHOW_WEEK_OF_YEAR;
  const firstDayOfWeek = config?.CALENDAR_FIRST_DAY_OF_WEEK;

  const weekNumbers =
    weekSetting !== false &&
    weekSetting !== null &&
    weekSetting !== 0 &&
    weekSetting !== "" &&
    weekSetting !== "0";

  useLayoutEffect(() => {
    current.current = change;
  });
  useLayoutEffect(() => {
    const element = input.current;
    const root = element?.closest("form") ?? element?.closest("fieldset") ?? element?.parentElement;

    if (!element || !root) return;
    let scope = scopes.get(root);

    if (!scope) {
      scope = createScope(root, locale, weekNumbers, firstDayOfWeek, t, () => scripts?.clearDate());
      scopes.set(root, scope);
    }

    owner.current = scope;

    const retire = scope.register({
      input: element,
      family,
      change: (value, dirty, event) => current.current(value, dirty, event),
    });

    return () => {
      owner.current = undefined;
      retire();
    };
  }, [input, locale, weekNumbers, firstDayOfWeek, t, scripts, family]);
  useImperativeHandle(
    ref,
    () => ({
      GetValue: () => owner.current?.api(family)?.GetValue() ?? input.current?.value ?? "",
      SetValue: (value) => owner.current?.api(family)?.SetValue(value),
      ChangeFormat: (format) => owner.current?.api(family)?.ChangeFormat(format),
      Clear: () => {
        owner.current?.api(family)?.Clear();
        owner.current?.synchronize(family);
      },
    }),
    [family, input],
  );
}
