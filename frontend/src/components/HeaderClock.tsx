import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { headerClockText } from "@/lib/header-clock";
import { Icon } from "./Icon";

export function HeaderClock() {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const text = headerClockText(now, t("moment_locale"));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <time className="header-clock" dateTime={now.toISOString()} aria-live="off">
      <Icon name="clock" />
      <span className="clock-small">{text.small}</span>
      <span className="clock-big">{text.big}</span>
    </time>
  );
}
