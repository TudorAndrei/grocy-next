import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys, request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { preferenceEnabled } from "@/lib/preferences";
import type { UserSettings } from "@/lib/types";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

export function ThermalPrintAction({ listId }: { listId: number }) {
  const { t } = useI18n();
  const features = useFeatures();
  const notify = useNotify();
  const [open, setOpen] = useState(false);

  const print = useMutation({
    mutationFn: ({ list, header }: { list: number; header: boolean }) =>
      request(`/api/print/shoppinglist/thermal?list=${list}&printHeader=${header}`),
    onSuccess: () => {
      setOpen(false);
      notify({ message: t("Print request sent") });
    },
  });

  if (!features.enabled("THERMAL_PRINTER") || !features.routeEnabled("/shopping")) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={print.isPending}
        onClick={() => {
          print.reset();
          setOpen(true);
        }}
      >
        {t("Thermal print")}
      </button>
      {open ? (
        <ThermalPrintDialog
          printing={print.isPending}
          error={print.error}
          onClose={() => setOpen(false)}
          onPrint={(header) => print.mutate({ list: listId, header })}
        />
      ) : null}
    </>
  );
}

function ThermalPrintDialog({
  printing,
  error,
  onClose,
  onPrint,
}: {
  printing: boolean;
  error: Error | null;
  onClose: () => void;
  onPrint: (header: boolean) => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const client = useQueryClient();
  const settings = useQuery({ queryKey: queryKeys.userSettings, queryFn: api.getUserSettings });
  const [chosen, setChosen] = useState<boolean>();

  const showHeader =
    chosen ??
    (settings.data?.shopping_list_print_show_header === undefined ||
      preferenceEnabled(settings.data.shopping_list_print_show_header));

  const status = useRef<HTMLParagraphElement>(null);

  const save = useMutation({
    mutationFn: (value: boolean) => api.putUserSetting("shopping_list_print_show_header", value),
    onSuccess: (_data, value) =>
      client.setQueryData<UserSettings>(queryKeys.userSettings, (previous) => ({
        ...previous,
        shopping_list_print_show_header: value,
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
            {t(printing ? "Connecting to printer..." : "Unable to print")}
          </p>
          {error ? <ErrorBlock message={error.message} /> : null}
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>
              {t("Close")}
            </button>
            {error ? (
              <button className="btn btn-primary" onClick={() => onPrint(showHeader)}>
                {t("Retry")}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onPrint(showHeader);
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
                save.mutate(event.target.checked);
              }}
            />
            <span>{t("Show header")}</span>
          </label>
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t("Cancel")}
            </button>
            <button
              className="btn btn-primary"
              disabled={settings.isPending || settings.isError || save.isPending}
            >
              {t("Thermal printer")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
