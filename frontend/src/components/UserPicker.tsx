import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

type User = { id: number; username: string; display_name?: string | null };

function display(user: User) {
  return user.display_name || user.username;
}

function highlighted(name: string, query: string) {
  if (!query) return name;
  const parts: ReactNode[] = [];
  const lower = name.toLowerCase();
  const needle = query.toLowerCase();
  let start = 0;
  let index = lower.indexOf(needle);

  while (index !== -1) {
    parts.push(
      name.slice(start, index),
      <strong key={index}>{name.slice(index, index + query.length)}</strong>,
    );
    start = index + query.length;
    index = lower.indexOf(needle, start);
  }

  parts.push(name.slice(start));

  return parts;
}

export function UserPicker({
  users,
  value,
  label,
  disabled = false,
  onChange,
}: {
  users: User[];
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hideTimer = useRef<number>(undefined);
  const hovered = useRef(false);
  const skipBlur = useRef(false);
  const selected = users.find((user) => String(user.id) === value);
  const selectedName = selected ? display(selected) : "";

  const [draft, setDraft] = useState({
    value,
    text: selectedName,
    selected: selected !== undefined,
  });

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  if (draft.value !== value || (draft.selected && draft.text !== selectedName)) {
    setDraft({ value, text: selectedName, selected: selected !== undefined });
    setOpen(false);
  }

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (value && !selected) onChange("");
  }, [value, selected, onChange]);

  const lower = query.toLowerCase();

  const rank = (user: User) =>
    display(user).toLowerCase().startsWith(lower) ? 0 : display(user).includes(query) ? 1 : 2;

  const matches = users
    .filter((user) => display(user).toLowerCase().includes(lower))
    .sort((left, right) => rank(left) - rank(right));

  const shown = open && !disabled && matches.length > 0;
  const blocked = () => disabled || input.current?.matches(":disabled") === true;

  const update = (id: string, text: string, selected: boolean) => {
    setDraft({ value: id, text, selected });
    onChange(id);
  };

  const choose = (user: User) => {
    if (blocked()) return;
    // The pinned combobox's name map keeps the last ID for duplicate display names.
    const target = users.filter((candidate) => display(candidate) === display(user)).at(-1) ?? user;
    update(String(target.id), display(target), true);
    hovered.current = false;
    setOpen(false);
    window.clearTimeout(hideTimer.current);
    input.current?.focus();
  };

  const toggle = () => {
    if (blocked()) return;
    hovered.current = false;

    if (draft.selected) {
      update("", "", false);
      setOpen(false);
    } else if (shown) setOpen(false);
    else {
      update("", "", false);
      setQuery("");
      setActive(0);
      setOpen(users.length > 0);
    }

    input.current?.focus();
  };

  const move = (index: number) => {
    const next = (index + matches.length) % matches.length;
    setActive(next);
    list.current?.children[next]?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="recipe-picker user-picker">
        <div className="recipe-picker-input">
          <input
            ref={input}
            id={id}
            role="combobox"
            autoComplete="off"
            value={draft.text}
            disabled={disabled}
            className={shown ? "combobox-menu-visible" : undefined}
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={`${id}-choices`}
            aria-activedescendant={shown ? `${id}-choice-${active}` : undefined}
            onChange={(event) => {
              if (blocked()) return;
              const text = event.target.value;
              update("", text, false);
              setQuery(text);
              setActive(0);
              setOpen(
                users.some((user) => display(user).toLowerCase().includes(text.toLowerCase())),
              );
            }}
            onBlur={() => {
              if (skipBlur.current) {
                skipBlur.current = false;

                return;
              }

              if (!draft.selected && draft.text) update("", "", false);

              if (!hovered.current && shown) {
                window.clearTimeout(hideTimer.current);
                hideTimer.current = window.setTimeout(() => setOpen(false), 200);
              }
            }}
            onKeyDown={(event) => {
              if (blocked()) return;

              if (shown) event.stopPropagation();

              if (event.key === "ArrowDown") {
                event.preventDefault();

                if (shown) move(active + 1);
                else toggle();
              } else if (shown && event.key === "ArrowUp") {
                event.preventDefault();
                move(active - 1);
              } else if (shown && (event.key === "Enter" || event.key === "Tab")) {
                event.preventDefault();
                const user = matches[active];

                if (user) choose(user);
              } else if (shown && event.key === "Escape") {
                event.preventDefault();
                hovered.current = false;
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost recipe-picker-toggle"
            disabled={disabled}
            aria-label={`${label}: ${t(draft.selected ? "Clear" : "Show options")}`}
            aria-expanded={draft.selected ? undefined : shown}
            aria-controls={draft.selected ? undefined : `${id}-choices`}
            aria-haspopup={draft.selected ? undefined : "listbox"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            <Icon
              name={draft.selected ? "close" : "back"}
              className={draft.selected ? "" : "recipe-picker-arrow"}
            />
          </button>
        </div>
        {shown ? (
          <ul
            ref={list}
            id={`${id}-choices`}
            className="recipe-picker-choices"
            role="listbox"
            aria-label={label}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) skipBlur.current = true;
            }}
          >
            {matches.map((user, index) => (
              <li
                key={`${user.id}:${index}`}
                id={`${id}-choice-${index}`}
                role="option"
                aria-selected={active === index}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  hovered.current = true;
                  setActive(index);
                }}
                onMouseLeave={() => {
                  hovered.current = false;
                }}
                onClick={() => choose(user)}
              >
                {highlighted(display(user), query)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
