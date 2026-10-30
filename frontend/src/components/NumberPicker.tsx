import { useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

export function NumberPicker({
  id,
  label,
  value,
  required,
  disabled,
  min,
  max,
  step,
  autoFocus,
  onChange,
  onFocus,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);

  const change = (delta: number) => {
    const current = input.current?.value ?? value;
    const number = Number.parseFloat(current || (delta === 1 ? "0" : "1"));
    onChange(String(number + delta));
  };

  return (
    <div className="number-picker">
      <input
        ref={input}
        id={id}
        type="number"
        value={value}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => onFocus?.(event.currentTarget.value)}
        onBlur={(event) => onBlur?.(event.currentTarget.value)}
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
