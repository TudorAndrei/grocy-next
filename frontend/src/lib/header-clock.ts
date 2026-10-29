import moment from "moment/min/moment-with-locales.js";

function legacyPunctuation(value: string, locale: string) {
  // These two locales changed apostrophes after the version bundled with Grocy 4.5.0.
  if (locale === "ca") return value.replaceAll("’", "'");

  return locale === "uk" ? value.replaceAll("ʼ", "’") : value;
}

export function headerClockText(date: Date, locale: string) {
  const selected = moment.locales().includes(locale) ? locale : "en";
  const value = moment(date).locale(selected);

  return {
    small: legacyPunctuation(value.format("l LT"), selected),
    big: legacyPunctuation(value.format("LLLL"), selected),
  };
}

export function contextualDateText(
  timestamp: string | null,
  now: Date,
  locale: string,
  translate: (message: string) => string,
) {
  const source = timestamp ?? "";

  if (source.length < 10) return { date: source, relative: "" };
  const selected = moment.locales().includes(locale) ? locale : "en";
  const value = moment(source).locale(selected);

  if (!value.isValid()) return { date: source, relative: "" };

  if (source.startsWith("2999-12-31")) return { date: translate("Never"), relative: "" };

  if (source.startsWith("2888-12-31")) return { date: translate("Unknown"), relative: "" };

  const relative =
    source.slice(0, 10) === moment(now).locale(selected).format("YYYY-MM-DD")
      ? translate("Today")
      : legacyPunctuation(value.from(moment(now)), selected);

  return { date: source, relative };
}
