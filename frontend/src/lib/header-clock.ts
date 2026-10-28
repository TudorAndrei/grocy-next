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
