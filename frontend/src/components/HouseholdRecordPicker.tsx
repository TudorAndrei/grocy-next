import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { z } from "zod";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import type { TrackingKind, TrackingRecord } from "@/lib/household-tracking";
import { CameraScanner } from "./CameraScanner";
import { Icon } from "./Icon";

export type HouseholdRecordPickerHandle = {
  GetValue: () => string;
  ResetAfterBooking: () => void;
};

const scannerEvent = z.object({
  barcode: z.string(),
  target: z.string().nullable().optional(),
});

function options(records: TrackingRecord[], query: string) {
  const folded = query.toLowerCase();
  const groups: TrackingRecord[][] = [[], [], []];

  for (const record of records) {
    const name = record.name ?? "";

    if (!name.toLowerCase().includes(folded)) continue;

    // The pinned sorter's assignment loop stops at an empty option name.
    if (!name) break;
    const rank = name.toLowerCase().startsWith(folded) ? 0 : name.includes(query) ? 1 : 2;
    groups[rank]!.push(record);
  }

  return groups.flat();
}

function highlighted(name: string, query: string) {
  if (!query) return name;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return name
    .split(new RegExp(`(${escaped})`, "ig"))
    .map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part));
}

function schedule(timers: Set<number>, signal: AbortSignal, callback: () => void, delay: number) {
  if (signal.aborted) return;

  const timer = window.setTimeout(() => {
    timers.delete(timer);

    if (!signal.aborted) callback();
  }, delay);

  timers.add(timer);
}

export function HouseholdRecordPicker({
  id,
  kind,
  records,
  value,
  disabled,
  inputRef,
  selectedInputRef,
  focusDelay,
  onChange,
  onCommit,
  onFocusNext,
  ref,
}: {
  id: string;
  kind: TrackingKind;
  records: TrackingRecord[];
  value: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  selectedInputRef: RefObject<HTMLInputElement | null>;
  focusDelay: () => number;
  onChange: (id: string) => void;
  onCommit: (record: TrackingRecord) => void;
  onFocusNext: () => void;
  ref?: Ref<HouseholdRecordPickerHandle>;
}) {
  const { t } = useI18n();
  const documentTasks = useDocumentTasks();
  const label = t(kind === "chore" ? "Chore" : "Battery");
  const listLabel = t(kind === "chore" ? "Chores" : "Batteries");

  const errorMessage = t(
    kind === "chore" ? "You have to select a chore" : "You have to select a battery",
  );

  const initial = records.find((record) => String(record.id) === value);
  const [text, setText] = useState(initial?.name ?? "");
  const [wireValue, setWireValue] = useState(value);
  const [selected, setSelected] = useState(Boolean(initial?.name));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [binding, setBinding] = useState({ external: value, source: value });
  const sourceValue = useRef(value);
  const selectedCache = useRef(Boolean(initial?.name));
  const list = useRef<HTMLUListElement>(null);
  const timers = useRef(new Set<number>());
  const lifetime = useRef<AbortSignal>(undefined);
  const hovered = useRef(false);
  const pluginBlur = useRef(true);
  const codeBlur = useRef(true);
  const menu = useRef(false);
  const activeItem = useRef(0);
  const scanHandler = useRef<(code: string) => void>(() => {});
  const blurHandler = useRef<() => void>(() => {});
  const current = useRef({ records, focusDelay, onChange, onCommit, onFocusNext, errorMessage });
  const matches = options(records, query);
  const shown = open && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  const blocked = () => disabled || inputRef.current?.matches(":disabled") === true;
  const alive = () => lifetime.current !== undefined && !lifetime.current.aborted;

  const show = (next: boolean) => {
    if (!next) pluginBlur.current = true;
    menu.current = next;
    setOpen(next);
  };

  const writeText = (next: string) => {
    if (inputRef.current) inputRef.current.value = next;
    setText(next);
  };

  const writeWire = (next: string) => {
    if (selectedInputRef.current) selectedInputRef.current.value = next;
    setWireValue(next);
  };

  const cache = (next: boolean) => {
    selectedCache.current = next;
    setSelected(next);
  };

  const source = (next: string, notify = true) => {
    sourceValue.current = next;
    setBinding((current) => (current.source === next ? current : { ...current, source: next }));
    inputRef.current?.setCustomValidity(next ? "" : current.current.errorMessage);

    if (notify) current.current.onChange(next);
  };

  const clearTarget = () => {
    source("");
    writeWire("");
    cache(false);
  };

  const resetAfterBooking = () => {
    // The source clears its select/text, without refreshing the plugin or hidden target.
    source("", false);
    writeText("");
  };

  const choose = (record: TrackingRecord) => {
    if (!alive()) return;

    const chosen =
      current.current.records.filter((row) => row.name === record.name).at(-1) ?? record;

    writeText(chosen.name ?? "");
    writeWire(String(chosen.id));
    source(String(chosen.id));
    cache(true);
    show(false);
    hovered.current = false;
    current.current.onCommit(chosen);
    inputRef.current?.focus();
  };

  const resolveCode = (raw: string) => {
    const parts = raw.split(":");

    const chosen =
      parts[1] === (kind === "chore" ? "c" : "b")
        ? current.current.records.find((record) => String(record.id) === parts[2])
        : undefined;

    if (!chosen) {
      source("");
      writeText("");

      return;
    }

    source(String(chosen.id));

    if (chosen.name) {
      writeText(chosen.name);
      writeWire(String(chosen.id));
      cache(true);
    }

    current.current.onCommit(chosen);
  };

  const lookup = (next: string) => {
    setQuery(next);
    activeItem.current = 0;
    setActive(0);
    show(options(current.current.records, next).length > 0);
  };

  const toggle = () => {
    if (!alive() || blocked()) return;
    hovered.current = false;

    if (selectedCache.current) {
      clearTarget();
      writeText("");
    } else if (menu.current) show(false);
    else {
      writeText("");
      lookup("");
    }

    inputRef.current?.focus();
  };

  const move = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    activeItem.current = next;
    setActive(next);
    list.current?.children[next]?.scrollIntoView?.({ block: "nearest" });
  };

  const blur = () => {
    if (!alive()) return;

    const raw = inputRef.current?.value ?? text;

    if (pluginBlur.current) {
      if (!selectedCache.current && raw) {
        source("");
        writeWire("");
      }

      if (!hovered.current && menu.current && lifetime.current)
        schedule(timers.current, lifetime.current, () => show(false), 200);
    }

    if (codeBlur.current && !menu.current && raw.startsWith("grcy")) resolveCode(raw);
  };

  const scan = (code: string) => {
    const signal = lifetime.current;

    if (!signal || signal.aborted) return;

    const cycle = () => {
      const input = inputRef.current;

      if (!input) return;
      let blurred = false;

      const observe = () => {
        blurred = true;
      };

      input.addEventListener("focusout", observe);
      input.focus();
      input.blur();
      input.removeEventListener("focusout", observe);

      if (!blurred) blurHandler.current();
    };

    cycle();
    writeText(code);
    schedule(
      timers.current,
      signal,
      () => {
        cycle();
        current.current.onFocusNext();
      },
      current.current.focusDelay(),
    );
  };

  useLayoutEffect(() => {
    current.current = { records, focusDelay, onChange, onCommit, onFocusNext, errorMessage };
    scanHandler.current = scan;
    blurHandler.current = blur;
    sourceValue.current = binding.source;
    selectedCache.current = selected;
    menu.current = shown;
    activeItem.current = activeIndex;
    inputRef.current?.setCustomValidity(sourceValue.current ? "" : errorMessage);
  });

  if (binding.external !== value) {
    setBinding({ external: value, source: value });

    // A parent's acknowledgement of clearTarget must not erase the typed query.
    if (binding.source !== value) {
      if (!value) setText("");
      else {
        const record = records.find((row) => String(row.id) === value);

        if (record?.name) {
          setText(record.name);
          setWireValue(value);
          setSelected(true);
        }
      }
    }
  }

  useImperativeHandle(ref, () => ({
    GetValue: () => sourceValue.current,
    ResetAfterBooking: resetAfterBooking,
  }));

  useEffect(() => {
    const owner = new AbortController();
    const signal = AbortSignal.any([owner.signal, documentTasks.capture().signal]);
    lifetime.current = signal;
    pluginBlur.current = true;
    codeBlur.current = true;

    const receive = (event: Event) => {
      if (signal.aborted || !(event instanceof CustomEvent)) return;
      const parsed = scannerEvent.safeParse(event.detail);

      if (!parsed.success) return;
      const target = parsed.data.target;

      if (target != null && target !== "undefined" && target !== `@${kind}picker`) return;
      scanHandler.current(parsed.data.barcode);
    };

    const retire = () => {
      document.removeEventListener("Grocy.BarcodeScanned", receive);

      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    };

    signal.addEventListener("abort", retire, { once: true });
    document.addEventListener("Grocy.BarcodeScanned", receive);
    schedule(timers.current, signal, () => inputRef.current?.focus(), current.current.focusDelay());

    return () => {
      owner.abort();
      signal.removeEventListener("abort", retire);
    };
  }, [documentTasks, kind, inputRef]);

  return (
    <div className="field">
      <input ref={selectedInputRef} type="hidden" name={`${kind}_id`} value={wireValue} />
      <label htmlFor={id}>{label}</label>
      <div className="recipe-picker">
        <div className="recipe-picker-input">
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            autoComplete="off"
            required
            disabled={disabled}
            value={text}
            className={shown ? "combobox-menu-visible" : undefined}
            aria-autocomplete="list"
            aria-controls={`${id}-choices`}
            aria-expanded={shown}
            aria-activedescendant={shown ? `${id}-choice-${activeIndex}` : undefined}
            onChange={(event) => {
              if (!alive()) return;
              setText(event.target.value);
            }}
            onBlur={blur}
            onKeyDown={(event) => {
              if (!alive() || !menu.current) return;
              event.stopPropagation();

              if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
                event.preventDefault();

              if (event.key === "ArrowDown") move(activeItem.current + 1);
              else if (event.key === "ArrowUp") move(activeItem.current - 1);
            }}
            onKeyUp={(event) => {
              if (!alive()) return;

              if (event.key === "ArrowDown") {
                if (!menu.current) toggle();
              } else if (event.key === "Enter" || event.key === "Tab") {
                if (!menu.current) return;
                const record = matches[activeItem.current];

                if (record) choose(record);
              } else if (event.key === "Escape") {
                if (!menu.current) return;
                show(false);
              } else if (
                ![
                  "ArrowUp",
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                  "Shift",
                  "Control",
                  "Alt",
                ].includes(event.key)
              ) {
                clearTarget();
                lookup(event.currentTarget.value);
              }

              event.stopPropagation();
              event.preventDefault();
            }}
          />
          <button
            type="button"
            className="btn btn-ghost recipe-picker-toggle"
            disabled={disabled}
            aria-label={`${label}: ${t(selected ? "Clear" : "Show options")}`}
            aria-expanded={selected ? undefined : shown}
            aria-controls={selected ? undefined : `${id}-choices`}
            aria-haspopup={selected ? undefined : "listbox"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            <Icon
              name={selected ? "close" : "back"}
              className={selected ? "" : "recipe-picker-arrow"}
            />
          </button>
        </div>
        {shown ? (
          <ul
            ref={list}
            id={`${id}-choices`}
            className="recipe-picker-choices combobox-menu-visible"
            role="listbox"
            aria-label={listLabel}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                // The pinned scroll guard detaches every direct blur listener.
                pluginBlur.current = false;
                codeBlur.current = false;
              }
            }}
          >
            {matches.map((record, index) => (
              <li
                key={`${record.id}:${index}`}
                id={`${id}-choice-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  hovered.current = true;
                  activeItem.current = index;
                  setActive(index);
                }}
                onMouseLeave={() => {
                  hovered.current = false;
                }}
                onClick={() => choose(record)}
              >
                {highlighted(record.name ?? "", query)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <CameraScanner
        label={`${label}: ${t("Scan with camera")}`}
        disabled={disabled}
        onScan={scan}
      />
    </div>
  );
}
