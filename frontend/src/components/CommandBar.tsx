import { useI18n } from "@/lib/i18n";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { api, queryKeys } from "@/lib/api";
import { stockAmount, useCatalog } from "@/lib/catalog";
import { usePreferences } from "@/lib/preferences";
import { useStockMove } from "@/lib/stockActions";
import { useFeatures } from "@/lib/features";
import { Icon, type IconName } from "./Icon";
import { useNotify } from "./Toaster";
import { NAV_GROUPS } from "./SiteNav";

export type Verb = "find" | "purchase" | "consume" | "list";

const VERBS: Array<{ id: Verb; label: string; words: string[] }> = [
  { id: "find", label: "Find", words: ["find", "go"] },
  { id: "purchase", label: "Purchase", words: ["buy", "purchase", "add"] },
  { id: "consume", label: "Consume", words: ["use", "eat", "consume"] },
  { id: "list", label: "Add to list", words: ["list", "shop"] },
];

type Parsed = { verb: Verb | null; amount: number | null; query: string };

/** "buy 2 milk" → purchase, 2, "milk". A leading verb word overrides the tab. */
export function parseCommand(text: string): Parsed {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let verb: Verb | null = null;
  const first = words[0]?.toLowerCase();
  const match = VERBS.find((v) => first && v.words.includes(first));

  if (match && words.length > 0) {
    verb = match.id;
    words.shift();
  }

  let amount: number | null = null;
  const maybe = Number(words[0]?.replace(",", "."));

  if (words.length > 0 && Number.isFinite(maybe) && maybe > 0) {
    amount = maybe;
    words.shift();
  }

  return { verb, amount, query: words.join(" ").toLowerCase() };
}

type CommandApi = { open: (verb?: Verb) => void };

const CommandContext = createContext<CommandApi>({ open: () => {} });

export function useCommandBar(): CommandApi {
  return useContext(CommandContext);
}

type Result =
  | { kind: "page"; key: string; label: string; to: string; icon: IconName }
  | { kind: "product"; key: string; productId: number };

export function CommandProvider({ children }: { children: ReactNode }) {
  const { t: tr } = useI18n();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [initialVerb, setInitialVerb] = useState<Verb>("find");

  const open = useCallback((verb: Verb = "find") => {
    setInitialVerb(verb);
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();

    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target instanceof Element ? e.target : null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']") != null;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      } else if (e.key === "/" && !typing && !isOpen) {
        e.preventDefault();
        open();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [open, isOpen]);

  const api = useMemo(() => ({ open }), [open]);

  return (
    <CommandContext.Provider value={api}>
      {children}
      <dialog
        ref={dialogRef}
        className="command"
        aria-label={tr("Quick actions")}
        onClose={() => setIsOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setIsOpen(false);
        }}
      >
        {isOpen ? (
          <CommandPanel initialVerb={initialVerb} onClose={() => setIsOpen(false)} />
        ) : null}
      </dialog>
    </CommandContext.Provider>
  );
}

function CommandPanel({ initialVerb, onClose }: { initialVerb: Verb; onClose: () => void }) {
  const { t: tr } = useI18n();

  const { formatAmount } = usePreferences();
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const features = useFeatures();
  const stockEnabled = features.enabled("STOCK");
  const shoppingEnabled = features.enabled("SHOPPINGLIST");
  const catalog = useCatalog(stockEnabled);

  const stock = useQuery({
    queryKey: queryKeys.stockOverview,
    queryFn: api.listStock,
    enabled: stockEnabled,
  });

  const [text, setText] = useState("");
  const [tabVerb, setTabVerb] = useState<Verb>(initialVerb);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const parsed = parseCommand(text);
  const verb = parsed.verb ?? tabVerb;
  const verbEnabled = verb === "find" || (stockEnabled && (verb !== "list" || shoppingEnabled));

  const verbs = VERBS.filter(
    (item) => item.id === "find" || (stockEnabled && (item.id !== "list" || shoppingEnabled)),
  );

  const amount = parsed.amount ?? 1;

  const purchase = useStockMove("purchase", stockEnabled);
  const consume = useStockMove("consume", stockEnabled);

  const addToList = useMutation({
    mutationFn: (productId: number) => api.addShoppingProduct(productId, amount),
    onSuccess: async (_data, productId) => {
      await queryClient.invalidateQueries({ queryKey: ["shopping"] });
      notify({
        message: tr(
          "Added %1$s %2$s to the list",
          String(catalog.amountText(productId, amount)),
          String(catalog.productName(productId)),
        ),
        undo: async () => {
          await api.removeShoppingProduct(productId, amount);
          await queryClient.invalidateQueries({ queryKey: ["shopping"] });
        },
      });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const onHand = useMemo(
    () => new Map((stock.data ?? []).map((item) => [item.product_id, stockAmount(item)])),
    [stock.data],
  );

  const results: Result[] = (() => {
    const q = parsed.query;

    const products: Result[] = (stockEnabled && verbEnabled ? catalog.products : [])
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.barcodes ?? []).some((code) => code.includes(q)),
      )
      .slice(0, 8)
      .map((p) => ({ kind: "product", key: `p${p.id}`, productId: p.id }));

    if (verb !== "find") return products;

    const pages: Result[] = NAV_GROUPS.flatMap((group) => group.links)
      .filter(
        (link) => features.routeEnabled(link.to) && q && tr(link.label).toLowerCase().includes(q),
      )
      .map((link) => ({
        kind: "page",
        key: `n${link.to}`,
        label: tr(link.label),
        to: link.to,
        icon: link.icon,
      }));

    return [...pages, ...products];
  })();

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(result: Result | undefined) {
    if (!result || !verbEnabled) return;

    if (result.kind === "page") {
      void navigate({ to: result.to });
      onClose();

      return;
    }

    const productId = result.productId;

    if (verb === "find") {
      void navigate({ to: "/products/$productId", params: { productId: String(productId) } });
    } else if (verb === "purchase") {
      purchase.mutate({ productId, amount });
    } else if (verb === "consume") {
      consume.mutate({ productId, amount });
    } else {
      addToList.mutate(productId);
    }

    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  }

  const verbLabel = tr(VERBS.find((v) => v.id === verb)?.label ?? "Find");

  return (
    <div className="command-panel">
      <div className="command-input">
        <Icon name="search" />
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={stockEnabled ? tr("buy 2 milk · use oats · or search") : tr("Search pages")}
          aria-label={tr("Command")}
          aria-controls="command-results"
          aria-activedescendant={results[active] ? `cmd-${results[active].key}` : undefined}
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>esc</kbd>
      </div>
      <div className="command-verbs" role="group" aria-label={tr("Action")}>
        {verbs.map((v) => (
          <button
            key={v.id}
            type="button"
            className="seg"
            aria-pressed={verb === v.id}
            onClick={() => {
              setTabVerb(v.id);
              setActive(0);

              if (parsed.verb) setText(text.trim().split(/\s+/).slice(1).join(" "));
            }}
          >
            {tr(v.label)}
          </button>
        ))}
      </div>
      <ul className="command-results" id="command-results" role="listbox" ref={listRef}>
        {results.length === 0 ? (
          <li className="command-empty">
            {verbEnabled
              ? tr("No results for “%s”.", String(parsed.query))
              : tr("This action is disabled in the server configuration.")}
          </li>
        ) : null}
        {results.map((result, index) => (
          <li
            key={result.key}
            id={`cmd-${result.key}`}
            role="option"
            aria-selected={index === active}
            data-index={index}
            onMouseMove={() => setActive(index)}
            onClick={() => run(result)}
          >
            {result.kind === "page" ? (
              <>
                <Icon name={result.icon} />
                <span className="command-name">{result.label}</span>
                <span className="command-hint">{tr("Go to")}</span>
              </>
            ) : (
              <>
                <span className="command-name">
                  {catalog.productName(result.productId)}
                  <small>
                    {catalog.location(catalog.product(result.productId)?.location_id)?.name ??
                      tr("No location")}
                    {" · "}
                    {catalog.amountText(result.productId, onHand.get(result.productId) ?? 0)}{" "}
                    {tr("on hand")}
                  </small>
                </span>
                <span className="command-hint">
                  {verb === "find"
                    ? tr("Open")
                    : `${verbLabel} ${formatAmount(amount)} ${catalog.stockUnitText(result.productId, amount)}`}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="command-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {tr("choose")}
        </span>
        <span>
          <kbd>↵</kbd> {verbLabel.toLowerCase()}
        </span>
        <span>
          {tr("Start with")} <b>{tr("buy")}</b>, <b>{tr("use")}</b> {tr("or")} <b>{tr("list")}</b>
          {tr(", then an amount")}
        </span>
      </p>
    </div>
  );
}
