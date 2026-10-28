import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { printShoppingDocument } from "@/lib/print-shopping";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys, request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { preferenceEnabled, usePreferences } from "@/lib/preferences";
import type { UserSettings } from "@/lib/types";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

export function ShoppingPrintAction({
  listId,
  paper = false,
  notes,
}: {
  listId: number;
  paper?: boolean;
  notes?: { html: string; visible: boolean };
}) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const features = useFeatures();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<AbortController | null>(null);

  const print = useMutation({
    mutationFn: ({
      list,
      header,
      grouped,
      layout,
    }: {
      list: number;
      header: boolean;
      grouped: boolean;
      layout: string;
    }) => {
      const controller = new AbortController();
      pending.current = controller;

      return paper
        ? printShoppingDocument(
            `/api/v2/shopping-lists/${list}/print?header=${header}&grouped=${grouped}&layout=${layout}`,
            {
              locale: t("moment_locale"),
              pluralIndex,
              amountPrecision: preferences.amountPrecision,
              priceDisplayPrecision: preferences.priceDisplayPrecision,
              currency: String(features.query.data?.CURRENCY ?? "USD"),
              beforePrint: () => flushSync(() => setOpen(false)),
              returnFocus: trigger.current,
              signal: controller.signal,
              notes,
            },
          )
        : request(`/api/print/shoppinglist/thermal?list=${list}&printHeader=${header}`);
    },
    onSuccess: () => {
      setOpen(false);

      if (paper) requestAnimationFrame(() => trigger.current?.focus());

      if (!paper) notify({ message: t("Print request sent") });
    },
  });

  if ((!paper && !features.enabled("THERMAL_PRINTER")) || !features.routeEnabled("/shopping"))
    return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost"
        disabled={print.isPending}
        onClick={() => {
          print.reset();
          setOpen(true);
        }}
      >
        {t(paper ? "Print" : "Thermal print")}
      </button>
      {open ? (
        <ShoppingPrintDialog
          paper={paper}
          printing={print.isPending}
          error={print.error}
          onClose={() => {
            if (paper) pending.current?.abort();
            setOpen(false);
          }}
          onPrint={(header, grouped, layout) =>
            print.mutate({ list: listId, header, grouped, layout })
          }
        />
      ) : null}
    </>
  );
}

function ShoppingPrintDialog({
  paper,
  printing,
  error,
  onClose,
  onPrint,
}: {
  paper: boolean;
  printing: boolean;
  error: Error | null;
  onClose: () => void;
  onPrint: (header: boolean, grouped: boolean, layout: string) => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const client = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.userSettings, queryFn: api.getUserSettings });
  const [chosen, setChosen] = useState<boolean>();
  const groupValue = settings.data?.shopping_list_print_group_by_product_group;
  const grouped = groupValue === undefined || preferenceEnabled(groupValue);
  const layout = String(settings.data?.shopping_list_print_layout_type ?? "table");

  const showHeader =
    chosen ??
    (settings.data?.shopping_list_print_show_header === undefined ||
      preferenceEnabled(settings.data.shopping_list_print_show_header));

  const status = useRef<HTMLParagraphElement>(null);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | string }) =>
      api.putUserSetting(key, value),
    onSuccess: (_data, { key, value }) =>
      client.setQueryData<UserSettings>(queryKeys.userSettings, (previous) => ({
        ...previous,
        [key]: value,
      })),
  });

  const preferenceError = settings.error ?? save.error;

  useEffect(() => {
    if (printing || error) status.current?.focus();
  }, [printing, error]);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t(printing || error ? "Printing" : "Print")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t(printing || error ? "Printing" : "Print")}</h2>
      {printing || error ? (
        <>
          <p ref={status} tabIndex={-1} role="status">
            {t(printing ? (paper ? "Loading..." : "Connecting to printer...") : "Unable to print")}
          </p>
          {error ? <ErrorBlock message={error.message} /> : null}
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>
              {t("Close")}
            </button>
            {error ? (
              <button
                className="btn btn-primary"
                onClick={() => onPrint(showHeader, grouped, layout)}
              >
                {t("Retry")}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onPrint(showHeader, grouped, layout);
          }}
        >
          {settings.isPending ? <LoadingBlock /> : null}
          {preferenceError ? <ErrorBlock message={preferenceError.message} /> : null}
          <label className="check-field">
            <input
              type="checkbox"
              checked={showHeader}
              disabled={settings.isPending || settings.isError || save.isPending}
              onChange={(event) => {
                setChosen(event.target.checked);
                save.mutate({
                  key: "shopping_list_print_show_header",
                  value: event.target.checked,
                });
              }}
            />
            <span>{t("Show header")}</span>
          </label>
          {paper ? (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={grouped}
                  disabled={settings.isPending || settings.isError || save.isPending}
                  onChange={(event) =>
                    save.mutate({
                      key: "shopping_list_print_group_by_product_group",
                      value: event.target.checked,
                    })
                  }
                />
                <span>{t("Group by product group")}</span>
              </label>
              <label className="field">
                <span>{t("Layout type")}</span>
                <select
                  value={layout}
                  disabled={settings.isPending || settings.isError || save.isPending}
                  onChange={(event) =>
                    save.mutate({
                      key: "shopping_list_print_layout_type",
                      value: event.target.value,
                    })
                  }
                >
                  <option value="table">{t("Table")}</option>
                  <option value="list">{t("List")}</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t("Cancel")}
            </button>
            <button
              className="btn btn-primary"
              disabled={settings.isPending || settings.isError || save.isPending}
            >
              {t(paper ? "Print" : "Thermal printer")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
