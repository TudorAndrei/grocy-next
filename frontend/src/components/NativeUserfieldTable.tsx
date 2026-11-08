import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useI18n } from "@/lib/i18n";
import type { UserfieldDefinition } from "@/lib/userfields";
import { nativeUserfieldFileDisplay } from "@/lib/native-userfield-file";
import type { TableOptions } from "@/lib/table-options";
import { UserfieldValue } from "./UserfieldValue";
import { StockTableRows } from "./StockTableOptions";
import { Icon } from "./Icon";

export function NativeUserfieldValue({
  field,
  value,
  present,
}: {
  field: UserfieldDefinition;
  value: string | null;
  present: boolean;
}) {
  if (!present) return null;

  if (field.type === "number-decimal" || field.type === "number-currency")
    return (
      <span
        className={`locale-number locale-number-${field.type === "number-decimal" ? "generic" : "currency"}${value ? " number-parsing-done" : ""}`}
      >
        <UserfieldValue field={field} value={value} />
      </span>
    );

  return <UserfieldValue field={field} value={value} nativeTable />;
}

export function NativeUserfieldRows({
  options,
  interactiveField,
  groups,
  children,
}: {
  options: TableOptions;
  interactiveField: UserfieldDefinition | undefined;
  groups: Array<{
    key: string;
    label: ReactNode;
    name: string;
    value: string | null;
    present: boolean;
  }>;
  children: ReactNode;
}) {
  const { t } = useI18n();

  if (!interactiveField)
    return (
      <StockTableRows options={options} groups={groups}>
        {children}
      </StockTableRows>
    );

  return (
    <tbody>
      {Children.toArray(children).map((row, index) => {
        const group = groups[index]!;
        const nonempty = group.value !== null && group.value !== "" && group.value !== "0";
        const image = interactiveField.type === "image" && nonempty;

        const control =
          group.present && (!["image", "file"].includes(interactiveField.type) || nonempty);

        const display = image ? nativeUserfieldFileDisplay(group.value!, "attribute") : group.name;
        const collapsed = options.collapsed(group.key);

        return (
          <Fragment key={isValidElement(row) ? row.key : index}>
            {index === 0 || groups[index - 1]?.key !== group.key ? (
              <tr className="stock-table-group" onClick={() => options.toggleGroup(group.key)}>
                <td colSpan={Math.max(1, options.visibleColumns.length)}>
                  <NativeUserfieldValue
                    field={interactiveField}
                    value={group.value}
                    present={group.present}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost stock-table-group-toggle"
                    aria-label={
                      control && display ? `${t("Group")}: ${display}` : display || t("Group")
                    }
                    aria-expanded={!collapsed}
                  >
                    <Icon name="back" />
                  </button>
                </td>
              </tr>
            ) : null}
            {isValidElement<{ style?: CSSProperties }>(row)
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
