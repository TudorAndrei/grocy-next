import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CameraScanner } from "./CameraScanner";
import { Icon } from "./Icon";

type Recipe = { id: number; name: string };

export function RecipePicker({
  recipes,
  value,
  text,
  disabled,
  open,
  onOpenChange: setOpen,
  onChange,
}: {
  recipes: Recipe[];
  value: string;
  text: string;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string, text: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hideTimer = useRef<number>(undefined);
  const [active, setActive] = useState(0);
  const query = text.toLowerCase();

  const rank = (recipe: Recipe) =>
    recipe.name.toLowerCase().startsWith(query) ? 0 : recipe.name.includes(text) ? 1 : 2;

  const matches = recipes
    .filter((recipe) => recipe.name.toLowerCase().includes(query))
    .sort((left, right) => rank(left) - rank(right));

  const shown = open && !disabled && matches.length > 0;

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const choose = (recipe: Recipe) => {
    // The native name map retains the last ID when recipe names are duplicated.
    const selected = recipes.filter((row) => row.name === recipe.name).at(-1) ?? recipe;
    onChange(String(selected.id), selected.name);
    setOpen(false);
    input.current?.focus();
  };

  const resolveCode = (code: string) => {
    if (!code.startsWith("grcy")) {
      onChange("", code);

      return;
    }

    const parts = code.split(":");

    const selected =
      parts[1] === "r" ? recipes.find((row) => String(row.id) === parts[2]) : undefined;

    onChange(selected ? String(selected.id) : "", selected?.name ?? "");
    setOpen(false);
  };

  const move = (index: number) => {
    const next = (index + matches.length) % matches.length;
    setActive(next);
    list.current?.children[next]?.scrollIntoView?.({ block: "nearest" });
  };

  const toggle = () => {
    if (value) {
      onChange("", "");
      setOpen(false);
    } else if (shown) setOpen(false);
    else {
      onChange("", "");
      setActive(0);
      setOpen(recipes.length > 0);
    }

    input.current?.focus();
  };

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
            aria-describedby={`${id}-hint`}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              onChange("", event.target.value);
              setActive(0);
              const query = event.target.value.toLowerCase();
              setOpen(recipes.some((recipe) => recipe.name.toLowerCase().includes(query)));
            }}
            onBlur={() => {
              window.clearTimeout(hideTimer.current);
              hideTimer.current = window.setTimeout(() => setOpen(false), 200);

              if (!shown && text.startsWith("grcy")) resolveCode(text);
            }}
            onKeyDown={(event) => {
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
                if (input.current?.form?.checkValidity()) input.current.blur();
                else choose(matches[active]!);
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
            className="recipe-picker-choices"
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
        onScan={resolveCode}
      />
      <small id={`${id}-hint`}>{t("This is for statistical purposes only")}</small>
    </div>
  );
}
