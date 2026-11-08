import { useEffect, useId, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { fetchApiDocument } from "@/lib/open-document";
import { HouseholdObjectEditor } from "./HouseholdObjectEditor";
import { NumberPicker } from "./NumberPicker";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

export function BatteryEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const id = useId();
  const nativeDocument = useDocumentTasks();

  return (
    <>
      <HouseholdObjectEditor
        entity="batteries"
        nativeDocument={nativeDocument}
        recordId={recordId}
        title={recordId === null ? "Create battery" : "Edit battery"}
        onSaved={onSaved}
        defaults={(row) => ({
          name: String(row?.name ?? ""),
          active: row ? (Number(row.active) === 1 ? "1" : "0") : "1",
          description: String(row?.description ?? ""),
          used_in: String(row?.used_in ?? ""),
          charge_interval_days: String(row?.charge_interval_days ?? "0"),
        })}
        fields={(values, change) => (
          <>
            <label className="field">
              {t("Name")}
              <input
                name="name"
                required
                autoFocus
                value={values.name}
                onChange={(event) => change("name", event.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                name="active"
                type="checkbox"
                checked={values.active === "1"}
                onChange={(event) => change("active", event.target.checked ? "1" : "0")}
              />
              {t("Active")}
            </label>
            <label className="field">
              {t("Description")}
              <input
                name="description"
                value={values.description}
                onChange={(event) => change("description", event.target.value)}
              />
            </label>
            <label className="field">
              {t("Used in")}
              <input
                name="used_in"
                value={values.used_in}
                onChange={(event) => change("used_in", event.target.value)}
              />
            </label>
            <div className="field">
              <label htmlFor={`${id}-interval`}>{t("Charge cycle interval (days)")}</label>
              <NumberPicker
                id={`${id}-interval`}
                name="charge_interval_days"
                label={t("Charge cycle interval (days)")}
                min={0}
                step="1"
                required
                value={values.charge_interval_days}
                onChange={(value) => change("charge_interval_days", value)}
              />
              <p className="field-hint">
                {t("0 means suggestions for the next charge cycle are disabled")}
              </p>
            </div>
          </>
        )}
      />
      {recordId !== null && Number.isInteger(recordId) && recordId > 0 ? (
        <BatteryCode id={recordId} />
      ) : null}
    </>
  );
}

function BatteryCode({ id }: { id: number }) {
  const { t } = useI18n();
  const features = useFeatures();
  const router = useRouter();
  const print = useNativeLabelPrint();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const [preview, setPreview] = useState<{ url?: string; error?: string }>();
  const code = `/battery/${id}/grocycode`;
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(`${code}?size=60`, controller.signal)
      .then((image) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(image);
        setPreview({ url });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setPreview({ error: error.message });
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [code]);

  return (
    <section aria-label={t("Grocycode")}>
      <h2>{t("Grocycode")}</h2>
      {preview?.url ? (
        <img src={preview.url} alt={t("Battery Grocycode")} />
      ) : !preview?.error ? (
        <LoadingBlock />
      ) : null}
      {preview?.error ? <ErrorBlock message={preview.error} /> : null}
      <div className="actions">
        <a className="btn btn-ghost btn-sm" href={`${root}${code}?download=true`}>
          {t("Download")}
        </a>
        {features.enabled("LABEL_PRINTER") ? (
          <a
            className="btn btn-ghost btn-sm battery-grocycode-label-print"
            data-battery-id={id}
            href="#"
            onClick={(event) => {
              event.preventDefault();
              print(`/api/batteries/${id}/printlabel`);
            }}
          >
            {t("Print on label printer")}
          </a>
        ) : null}
      </div>
    </section>
  );
}
