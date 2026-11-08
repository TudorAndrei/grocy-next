import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { CameraScanner } from "./CameraScanner";
import { Icon } from "./Icon";

type Recipe = { id: number; name: string };

const scannerEvent = z.object({ barcode: z.string(), target: z.string().optional() });

export function RecipePicker({
  recipes,
  value,
  text,
  disabled,
  open,
  required = false,
  hint = "This is for statistical purposes only",
  chooseOnEnter = false,
  nativeMealPlan = false,
  scanDelay = () => 0,
  onOpenChange: setOpen,
  onChange,
}: {
  recipes: Recipe[];
  value: string;
  text: string;
  disabled: boolean;
  open: boolean;
  required?: boolean;
  hint?: string;
  chooseOnEnter?: boolean;
  nativeMealPlan?: boolean;
  scanDelay?: () => number;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string, text: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(value);
  const list = useRef<HTMLUListElement>(null);
  const hideTimer = useRef<number>(undefined);
  const [active, setActive] = useState(0);
  const [lookupText, setLookupText] = useState("");
  const nativeTimers = useRef(new Set<number>());
  const scanHandler = useRef<(code: string) => void>(() => {});
  const queryText = nativeMealPlan ? lookupText : text;
  const query = queryText.toLowerCase();

  const rank = (recipe: Recipe) =>
    recipe.name.toLowerCase().startsWith(query) ? 0 : recipe.name.includes(queryText) ? 1 : 2;

  const matches = recipes
    .filter((recipe) => recipe.name.toLowerCase().includes(query))
    .sort((left, right) => rank(left) - rank(right));

  const shown = open && !disabled && matches.length > 0;

  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);

      for (const timer of nativeTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    if (!nativeMealPlan) return;

    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = scannerEvent.safeParse(event.detail);

      if (!parsed.success) return;

      if (
        parsed.data.target !== undefined &&
        !["@recipepicker", "undefined"].includes(parsed.data.target)
      )
        return;
      scanHandler.current(parsed.data.barcode);
    };

    document.addEventListener("Grocy.BarcodeScanned", receive);

    return () => document.removeEventListener("Grocy.BarcodeScanned", receive);
  }, [nativeMealPlan]);

  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? t("You have to select a recipe") : "");
  }, [required, value, t]);

  const change = (id: string, display: string) => {
    selection.current = id;
    onChange(id, display);
  };

  const choose = (recipe: Recipe) => {
    // The native name map retains the last ID when recipe names are duplicated.
    const selected = recipes.filter((row) => row.name === recipe.name).at(-1) ?? recipe;
    change(String(selected.id), selected.name);
    setOpen(false);
    input.current?.focus();
  };

  const resolveCode = (code: string) => {
    if (!code.startsWith("grcy")) {
      change("", code);

      return;
    }

    const parts = code.split(":");

    const selected =
      parts[1] === "r" ? recipes.find((row) => String(row.id) === parts[2]) : undefined;

    change(selected ? String(selected.id) : "", selected?.name ?? "");
    setOpen(false);
  };

  const move = (index: number) => {
    const next = (index + matches.length) % matches.length;
    setActive(next);
    list.current?.children[next]?.scrollIntoView?.({ block: "nearest" });
  };

  const toggle = () => {
    if (value) {
      change("", "");
      setOpen(false);
    } else if (shown) setOpen(false);
    else {
      change("", "");

      if (nativeMealPlan) setLookupText("");
      setActive(0);
      setOpen(recipes.length > 0);
    }

    input.current?.focus();
  };

  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      nativeTimers.current.delete(timer);
      callback();
    }, delay);

    nativeTimers.current.add(timer);
  };

  const blur = () => {
    const currentText = input.current?.value ?? text;

    if (nativeMealPlan) {
      if (shown) later(() => setOpen(false), 200);
    } else {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setOpen(false), 200);
    }

    if (!shown && currentText.startsWith("grcy")) resolveCode(currentText);
  };

  const scan = (code: string) => {
    if (!nativeMealPlan) {
      resolveCode(code);

      return;
    }

    // The native scanner's delayed blur belongs to the static document control,
    // so a hide/reopen must neither cancel it nor freeze an old recipe value.
    const cycle = () => {
      const element = input.current;

      if (!element) return;
      let blurred = false;

      const observe = () => {
        blurred = true;
      };

      element.addEventListener("focusout", observe);
      element.focus();
      element.blur();
      element.removeEventListener("focusout", observe);

      // A hidden static modal cannot receive native focus, but the source's
      // jQuery blur dispatch still invokes its control handlers there.
      if (!blurred) element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    };

    cycle();
    change(selection.current, code);

    if (input.current) input.current.value = code;
    later(cycle, scanDelay());
  };

  useLayoutEffect(() => {
    selection.current = value;
    scanHandler.current = scan;
  });

  return (
    <div className="field">
      <label htmlFor={id}>{t("Recipe")}</label>
      <div className="recipe-picker">
        <div className="recipe-picker-input">
          <input
            ref={input}
            id={id}
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={`${id}-choices`}
            aria-expanded={shown}
            aria-activedescendant={shown ? `${id}-choice-${active}` : undefined}
            aria-describedby={hint ? `${id}-hint` : undefined}
            required={required}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              if (nativeMealPlan) {
                change(selection.current, event.target.value);

                return;
              }

              change("", event.target.value);
              setActive(0);
              const query = event.target.value.toLowerCase();
              setOpen(recipes.some((recipe) => recipe.name.toLowerCase().includes(query)));
            }}
            onBlur={blur}
            onKeyUp={(event) => {
              if (!nativeMealPlan) return;

              if (event.key === "ArrowDown") {
                if (!shown) toggle();
              } else if (["Enter", "Tab"].includes(event.key)) {
                if (shown) choose(matches[active]!);
              } else if (event.key === "Escape") {
                setOpen(false);
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
                const next = event.currentTarget.value;
                change("", next);
                setLookupText(next);
                setActive(0);
                setOpen(
                  recipes.some((recipe) => recipe.name.toLowerCase().includes(next.toLowerCase())),
                );
              }
            }}
            onKeyDown={(event) => {
              if (nativeMealPlan) {
                if (!shown) return;

                if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
                  event.preventDefault();

                if (event.key === "ArrowDown") move(active + 1);
                else if (event.key === "ArrowUp") move(active - 1);
                else if (event.key === "Escape") event.stopPropagation();

                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();

                if (shown) move(active + 1);
                else toggle();
              } else if (shown && event.key === "ArrowUp") {
                event.preventDefault();
                move(active - 1);
              } else if (shown && event.key === "Enter") {
                event.preventDefault();

                // Native consume clicks OK on keydown. That click blurs a valid
                // form before the combobox can select its recipe on keyup.
                if (chooseOnEnter || !input.current?.form?.checkValidity())
                  choose(matches[active]!);
                else input.current.blur();
              } else if (shown && event.key === "Tab") {
                event.preventDefault();
                choose(matches[active]!);
              } else if (shown && event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost recipe-picker-toggle"
            aria-label={value ? `${t("Recipe")}: ${t("Clear")}` : t("Recipes")}
            aria-expanded={value ? undefined : shown}
            aria-controls={value ? undefined : `${id}-choices`}
            aria-haspopup={value ? undefined : "listbox"}
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            <Icon name={value ? "close" : "back"} className={value ? "" : "recipe-picker-arrow"} />
          </button>
        </div>
        {shown ? (
          <ul
            ref={list}
            id={`${id}-choices`}
            className={`recipe-picker-choices${nativeMealPlan ? " combobox-menu-visible" : ""}`}
            role="listbox"
            aria-label={t("Recipes")}
          >
            {matches.map((recipe, index) => (
              <li
                key={recipe.id}
                id={`${id}-choice-${index}`}
                role="option"
                aria-selected={index === active}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(recipe)}
              >
                {recipe.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <CameraScanner
        label={`${t("Recipe")}: ${t("Scan with camera")}`}
        disabled={disabled}
        onScan={scan}
      />
      {hint ? <small id={`${id}-hint`}>{t(hint)}</small> : null}
    </div>
  );
}
