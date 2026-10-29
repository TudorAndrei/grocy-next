import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
  type ThHTMLAttributes,
} from "react";
import type { TableOptions } from "@/lib/table-options";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { Icon } from "./Icon";

function cells(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? cells(child.props.children)
      : [child],
  );
}

export function StockTableCells({
  options,
  children,
  headers = false,
}: {
  options: TableOptions;
  children: ReactNode;
  headers?: boolean;
}) {
  const content = cells(children);
  const source = options.columns.filter((c) => c.rendered !== false);

  return options.visibleColumns.map((column) => {
    const cell = content[source.findIndex((c) => c.key === column.key)];

    if (!isValidElement<ThHTMLAttributes<HTMLTableCellElement>>(cell)) return null;

    if (!headers) return cloneElement(cell, { key: `${options.cellVersion}:${column.key}` });

    return cloneElement(cell, {
      key: column.key,
      draggable: true,
      onDragStart: (event) => event.dataTransfer.setData("text/plain", column.key),
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.move(event.dataTransfer.getData("text/plain"), column.key);
      },
    });
  });
}

export function StockTableRows({
  options,
  groups,
  children,
}: {
  options: TableOptions;
  groups: { key: string; label: ReactNode; name: string }[];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const rows = Children.toArray(children);

  return (
    <tbody>
      {!options.groupColumn || groups.length === 0
        ? rows
        : rows.map((row, i) => {
            const group = groups[i] ?? { key: "", label: "", name: "" };
            const collapsed = options.collapsed(group.key);

            return (
              <Fragment key={isValidElement(row) ? row.key : i}>
                {i === 0 || groups[i - 1]?.key !== group.key ? (
                  <tr className="stock-table-group">
                    <td colSpan={Math.max(1, options.visibleColumns.length)}>
                      <button
                        type="button"
                        className="btn btn-ghost stock-table-group-toggle"
                        aria-label={group.name || t("Group")}
                        aria-expanded={!collapsed}
                        onClick={() => options.toggleGroup(group.key)}
                      >
                        <span>{group.label}</span>
                        <Icon name="back" />
                      </button>
                    </td>
                  </tr>
                ) : null}
                {isValidElement<{ style?: React.CSSProperties }>(row)
                  ? cloneElement(row, {
                      style: {
                        ...row.props.style,
                        display: collapsed ? "none" : row.props.style?.display,
                      },
                    })
                  : row}
              </Fragment>
            );
          })}
    </tbody>
  );
}

export function StockTableStatus({ options }: { options: TableOptions }) {
  const { t } = useI18n();

  return (
    <>
      {!options.ready && !options.error ? (
        <LoadingBlock label={t("Loading table options…")} />
      ) : null}
      {options.error ? (
        <>
          <ErrorBlock message={options.error.message} />
          <button type="button" className="btn" onClick={options.retry}>
            {t("Retry table options")}
          </button>
        </>
      ) : null}
    </>
  );
}

export function StockTableOptions({
  options,
  onReset,
}: {
  options: TableOptions;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        {t("Table options")}
      </button>
      {open ? (
        <OptionsDialog options={options} onClose={() => setOpen(false)} onReset={onReset} />
      ) : null}
    </>
  );
}

function OptionsDialog({
  options,
  onClose,
  onReset,
}: {
  options: TableOptions;
  onClose: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [confirm, setConfirm] = useState(false);
  const ordered = options.order.flatMap((i) => (options.columns[i] ? [options.columns[i]] : []));

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-table-options"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!options.pending) onClose();
      }}
    >
      <h2 id={title}>{t("Table options")}</h2>
      {options.error ? (
        <>
          <ErrorBlock message={options.error.message} />
          <button type="button" className="btn" onClick={options.retry}>
            {t("Retry table options")}
          </button>
        </>
      ) : null}
      <fieldset>
        <legend>{t("Hide/view columns")}</legend>
        <ol className="stock-table-column-list">
          {ordered.map((column, position) =>
            column.configurable === false || column.rendered === false ? null : (
              <li key={column.key}>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={options.visible(column.key)}
                    onChange={(e) => options.show(column.key, e.target.checked)}
                  />
                  {t(column.label)}
                </label>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={position === 0}
                    aria-label={t("Move %s earlier", t(column.label))}
                    onClick={() => {
                      const previous = ordered[position - 1];

                      if (previous) options.move(column.key, previous.key);
                    }}
                  >
                    {t("Earlier")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={position === ordered.length - 1}
                    aria-label={t("Move %s later", t(column.label))}
                    onClick={() => {
                      const next = ordered[position + 1];

                      if (next) options.move(column.key, next.key);
                    }}
                  >
                    {t("Later")}
                  </button>
                </div>
              </li>
            ),
          )}
        </ol>
      </fieldset>
      <fieldset>
        <legend>{t("Group by")}</legend>
        <label className="check-field">
          <input
            type="radio"
            name={`${title}-group`}
            checked={!options.groupSelection}
            onChange={() => options.groupBy("")}
          />
          {t("None")}
        </label>
        {ordered.map((column) =>
          !column.groupable || column.rendered === false ? null : (
            <label key={column.key} className="check-field">
              <input
                type="radio"
                name={`${title}-group`}
                checked={
                  options.groupSelection ===
                  (column.groupIndex === undefined
                    ? column.key
                    : options.columns[options.order[column.groupIndex]]?.key)
                }
                onChange={() => options.groupBy(column.key)}
              />
              {t(column.label)}
            </label>
          ),
        )}
      </fieldset>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={options.pending}
          onClick={() => setConfirm(true)}
        >
          {t("Reset")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={options.pending}
          onClick={onClose}
        >
          {t("OK")}
        </button>
      </div>
      {confirm ? (
        <ResetConfirmation
          options={options}
          onCancel={() => setConfirm(false)}
          onReset={() => {
            onReset();
            onClose();
          }}
        />
      ) : null}
    </dialog>
  );
}

function ResetConfirmation({
  options,
  onCancel,
  onReset,
}: {
  options: TableOptions;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-table-options"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!options.pending) onCancel();
      }}
    >
      <h2 id={title}>{t("Are you sure you want to reset the table options?")}</h2>
      {options.error ? <ErrorBlock message={options.error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={options.pending} onClick={onCancel}>
          {t("No")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={options.pending}
          onClick={() => {
            // The confirmation and shared status display a failed reset.
            void options.reset(onReset).catch(() => {});
          }}
        >
          {t("Yes")}
        </button>
      </div>
    </dialog>
  );
}
