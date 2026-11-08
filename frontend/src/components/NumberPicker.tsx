import { useRef, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { preferenceEnabled } from "@/lib/preferences";
import { normalizeCurrencyInput } from "@/lib/stock-settings";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

export function NumberPicker({
  id,
  name,
  label,
  value,
  required,
  disabled,
  min,
  max,
  step,
  autoFocus,
  currency = false,
  inputRef,
  onStep,
  onKeyUp,
  onChange,
  onFocus,
  onBlur,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step: string;
  autoFocus?: boolean;
  currency?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onStep?: (value: string) => void;
  onKeyUp?: (value: string) => void;
  onChange: (value: string) => void;
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  const { t } = useI18n();
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  const settings = useQuery({ ...userSettingsQuery(), enabled: currency });

  const change = (delta: number) => {
    const current = input.current?.value ?? value;
    const number = Number.parseFloat(current || (delta === 1 ? "0" : "1"));
    const next = String(number + delta);

    if (input.current) input.current.value = next;
    onChange(next);
    onStep?.(next);
  };

  return (
    <div className="number-picker">
      <input
        ref={input}
        id={id}
        name={name}
        type="number"
        value={value}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyUp={(event) => onKeyUp?.(event.currentTarget.value)}
        onFocus={(event) => onFocus?.(event.currentTarget.value)}
        onBlur={(event) => {
          const raw = event.currentTarget.value;

          const next = normalizeCurrencyInput(
            raw,
            Number(settings.data?.stock_decimal_places_prices_input ?? 2),
            currency && preferenceEnabled(settings.data?.stock_auto_decimal_separator_prices),
          );

          if (next !== raw) onChange(next);
          onBlur?.(next);
        }}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          change(event.key === "ArrowUp" ? 1 : -1);
        }}
      />
      {([1, -1] as const).map((delta) => {
        const name = t(delta === 1 ? "Increase %s" : "Decrease %s", label);

        return (
          <button
            key={delta}
            type="button"
            className="btn number-picker-step"
            aria-label={name}
            aria-controls={id}
            title={name}
            onClick={() => change(delta)}
          >
            <Icon name={delta === 1 ? "up" : "down"} />
          </button>
        );
      })}
    </div>
  );
}
