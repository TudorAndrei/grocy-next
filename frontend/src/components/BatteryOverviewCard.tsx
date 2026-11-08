import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  decodeTrackingDetails,
  requestBatteryOverviewCard,
  type TrackingDetails,
} from "@/lib/household-tracking";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { tableDate } from "@/lib/native-table-cell";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { StockTableDate } from "./StockTableDate";

export type BatteryCardRequest = { id: number; sequence: number };

export function BatteryOverviewCard({
  request,
  open,
  onClose,
}: {
  request: BatteryCardRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const scope = useRef<AbortController>(undefined);
  const [data, setData] = useState<{ value: TrackingDetails; at: number }>();
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!request) return;
    const signal = scope.current?.signal;
    // Selecting another card or hiding it does not cancel native card callbacks.
    void requestBatteryOverviewCard(request.id, signal).then(
      (response) => {
        window.queueMicrotask(() => {
          if (signal?.aborted) return;
          setData({ value: decodeTrackingDetails("battery", response), at: Date.now() });
        });
      },
      (error: Error) => {
        if (signal?.aborted) return;

        if (error instanceof ApiError && (error.status === 200 || error.status === 204)) {
          window.queueMicrotask(() => {
            if (!signal?.aborted) throw error;
          });
        } else console.error(error);
      },
    );
  }, [request]);

  return open ? <CardDialog data={data} onClose={onClose} /> : null;
}

function CardDialog({
  data,
  onClose,
}: {
  data: { value: TrackingDetails; at: number } | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const [journal, setJournal] = useState<EmbeddedPage>();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Battery overview")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2>{t("Battery overview")}</h2>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <div className="actions">
        {data ? (
          <>
            <Link
              className="btn"
              to="/battery/$batteryId"
              params={{ batteryId: String(data.value.record.id) }}
            >
              {t("Edit battery")}
            </Link>
            <Link
              className="btn"
              to="/batteriesjournal"
              search={{ embedded: "", battery: String(data.value.record.id) }}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                setJournal({ id: Date.now(), url: event.currentTarget.href, dialogType: "table" });
              }}
            >
              {t("Battery journal")}
            </Link>
          </>
        ) : (
          <>
            <a
              className="btn"
              href="#"
              aria-disabled="true"
              tabIndex={-1}
              onClick={(event) => event.preventDefault()}
            >
              {t("Edit battery")}
            </a>
            <a
              className="btn"
              href="#"
              aria-disabled="true"
              tabIndex={-1}
              onClick={(event) => event.preventDefault()}
            >
              {t("Battery journal")}
            </a>
          </>
        )}
      </div>
      <h3>{data?.value.record.name ?? ""}</h3>
      <dl className="product-overview-facts">
        <div>
          <dt>{t("Used in")}</dt>
          <dd>{data?.value.record.used_in ?? ""}</dd>
        </div>
        <div>
          <dt>{t("Charge cycles count")}</dt>
          <dd>{data ? String(data.value.count) : ""}</dd>
        </div>
        <div>
          <dt>{t("Last charged")}</dt>
          <dd>
            {data ? (
              data.value.lastTime ? (
                <StockTableDate
                  value={tableDate(data.value.lastTime, new Date(data.at), t("moment_locale"), t)}
                />
              ) : (
                t("never")
              )
            ) : null}
          </dd>
        </div>
      </dl>
      {journal ? <EmbeddedPageDialog page={journal} onClose={() => setJournal(undefined)} /> : null}
    </dialog>
  );
}
