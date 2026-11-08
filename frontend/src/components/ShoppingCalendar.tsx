import { useId, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import type { JsonValue } from "@/lib/json";
import { useI18n } from "@/lib/i18n";
import { BookingCalendar, type CalendarView } from "./BookingCalendar";

export function ShoppingCalendar({ firstDayOfWeek }: { firstDayOfWeek?: JsonValue }) {
  const { t, ready } = useI18n();
  const [initial, setInitial] = useState<{ locale: string; firstDay: string }>();

  if (!initial && ready) {
    const translated = t("moment_locale");
    setInitial({
      locale: moment.locales().includes(translated) ? translated : "en",
      firstDay: String(firstDayOfWeek ?? ""),
    });
  }

  return initial ? (
    <ShoppingCalendarView locale={initial.locale} firstDay={initial.firstDay} />
  ) : null;
}

function ShoppingCalendarView({ locale, firstDay }: { locale: string; firstDay: string }) {
  const { t } = useI18n();
  const id = useId();
  const [date, setDate] = useState(Date.now);
  const [selected, setSelected] = useState(() => moment().format("YYYY-MM-DD"));
  const [view, setView] = useState<CalendarView>("days");

  return (
    <section className="shopping-calendar panel" aria-label={t("Calendar")}>
      <h2>{t("Calendar")}</h2>
      <BookingCalendar
        id={id}
        label={t("Calendar")}
        date={date}
        view={view}
        selected={selected}
        locale={locale}
        firstDayOfWeek={firstDay}
        weekNumbers
        above={false}
        inline
        onDate={setDate}
        onView={setView}
        onSelect={(value) => {
          setSelected(value);
          setDate(moment(value).valueOf());
        }}
        onToday={() => {
          const now = moment();
          setSelected(now.format("YYYY-MM-DD"));
          setDate(now.valueOf());
        }}
        onClose={() => {}}
      />
    </section>
  );
}
