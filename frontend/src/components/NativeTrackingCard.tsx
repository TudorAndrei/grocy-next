import DOMPurify from "dompurify";
import moment from "moment/min/moment-with-locales.js";
import { useRouter } from "@tanstack/react-router";
import { contextualDateText } from "@/lib/header-clock";
import type { TrackingDetails, TrackingKind } from "@/lib/household-tracking";
import { useI18n } from "@/lib/i18n";

function descriptionHtml(description: string | null | undefined) {
  const withBreaks = (description ?? "").replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, "$1<br>$2");

  // Sanitize the complete source nl2br result, then leave its HTML unchanged.
  return DOMPurify.sanitize(withBreaks);
}

export function NativeTrackingCard({
  kind,
  card,
  refreshedAt,
  assignments,
  onJournal,
}: {
  kind: TrackingKind;
  card: TrackingDetails | undefined;
  refreshedAt: number;
  assignments: boolean;
  onJournal: (id: number, url: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const sourceId = `${kind}card-${kind}`;
  const onlyDate = kind === "chore" && card?.record.track_date_only === 1;
  const locale = t("moment_locale");
  const selectedLocale = moment.locales().includes(locale) ? locale : "en";
  const timestamp = card?.lastTime || "";
  const last = contextualDateText(timestamp, new Date(refreshedAt), locale, t);
  const displayDate = card && !timestamp ? t("never") : last.date;

  // The source returns before date-only truncation for short or invalid dates.
  const absolute =
    onlyDate && timestamp.length >= 10 && moment(timestamp, undefined, selectedLocale).isValid()
      ? displayDate.slice(0, 10)
      : displayDate;

  const journalUrl = card
    ? `${root}/${kind === "chore" ? "choresjournal" : "batteriesjournal"}?embedded&${kind}=${card.record.id}`
    : "#";

  return (
    <section
      className={`panel ${kind}card`}
      aria-label={t(kind === "chore" ? "Chore overview" : "Battery overview")}
    >
      <header className="panel-head" style={{ flexWrap: "wrap" }}>
        <h2 className="panel-title" style={{ margin: 0 }}>
          {t(kind === "chore" ? "Chore overview" : "Battery overview")}
        </h2>
        <div className="actions" style={{ margin: 0 }}>
          <a
            id={`${sourceId}-journal-button`}
            className={`btn btn-sm${card ? "" : " disabled"}`}
            href={journalUrl}
            aria-disabled={card ? undefined : true}
            style={card ? undefined : { pointerEvents: "none", opacity: 0.65 }}
            onClick={(event) => {
              event.preventDefault();
              onJournal(card?.record.id ?? 0, event.currentTarget.href);
            }}
          >
            {t(kind === "chore" ? "Chore journal" : "Battery journal")}
          </a>
          <a
            id={`${sourceId}-edit-button`}
            className={`btn btn-ghost btn-sm${card ? "" : " disabled"}`}
            href={card ? `${root}/${kind}/${card.record.id}` : "#"}
            aria-disabled={card ? undefined : true}
            style={card ? undefined : { pointerEvents: "none", opacity: 0.65 }}
          >
            {t(kind === "chore" ? "Edit chore" : "Edit battery")}
          </a>
        </div>
      </header>
      <div className="panel-body">
        <h3 id={`${sourceId}-name`}>{card?.record.name ?? ""}</h3>
        {kind === "chore" ? (
          <div
            id={`${sourceId}-description`}
            className="rich-content"
            dangerouslySetInnerHTML={{ __html: descriptionHtml(card?.record.description) }}
          />
        ) : null}
        <dl className="product-overview-facts">
          {kind === "battery" ? (
            <div>
              <dt>{t("Used in")}</dt>
              <dd id={`${sourceId}-used_in`}>{card?.record.used_in ?? ""}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t(kind === "chore" ? "Tracked count" : "Charge cycles count")}</dt>
            <dd
              id={`${sourceId}-${kind === "chore" ? "tracked-count" : "charge-cycles-count"}`}
              className="locale-number locale-number-generic"
            >
              {card ? card.count || 0 : ""}
            </dd>
          </div>
          {kind === "chore" ? (
            <div>
              <dt>{t("Average execution frequency")}</dt>
              <dd id="chorecard-average-execution-frequency">
                {card
                  ? card.frequencyHours === null
                    ? t("Unknown")
                    : moment
                        .duration(card.frequencyHours / 24, "days")
                        .locale(locale)
                        .humanize()
                  : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t(kind === "chore" ? "Last tracked" : "Last charged")}</dt>
            <dd>
              <span id={`${sourceId}-${kind === "chore" ? "last-tracked" : "last-charged"}`}>
                {absolute}
              </span>{" "}
              <time
                id={`${sourceId}-${kind === "chore" ? "last-tracked" : "last-charged"}-timeago`}
                className={`timeago timeago-contextual${onlyDate ? " timeago-date-only" : ""}`}
                dateTime={card ? card.lastTime || "" : undefined}
              >
                {last.relative}
              </time>
            </dd>
          </div>
          {kind === "chore" && assignments ? (
            <div>
              <dt>{t("Last done by")}</dt>
              <dd id="chorecard-chore-last-done-by">
                {card ? card.lastDoneBy || t("Unknown") : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
