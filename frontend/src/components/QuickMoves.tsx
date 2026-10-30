import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useCatalog } from "@/lib/catalog";
import { useStockMove } from "@/lib/stockActions";

type QuickMovesProps = {
  productId: number;
  name: string;
  amount: number;
};

/**
 * One-tap +1 / Consume for products counted in pieces. Weighed or measured
 * products open the product page instead, because "+1" would book 1 g.
 */
export function QuickMoves({ productId, name, amount }: QuickMovesProps) {
  const { t: tr } = useI18n();

  const catalog = useCatalog();
  const purchase = useStockMove("purchase");
  const consume = useStockMove("consume");
  const params = { productId: String(productId) };

  if (!catalog.countsItems(productId)) {
    return (
      <>
        <Link
          to="/products/$productId"
          params={params}
          search={{ move: "purchase" }}
          className="btn btn-sm"
          aria-label={tr("Purchase %s", String(name))}
        >
          {tr("Purchase…")}
        </Link>
        <Link
          to="/products/$productId"
          params={params}
          search={{ move: "consume" }}
          className="btn btn-sm"
          aria-disabled={amount <= 0}
          aria-label={tr("Consume %s", String(name))}
        >
          {tr("Consume…")}
        </Link>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={purchase.isPending}
        onClick={() => purchase.mutate({ productId, amount: 1 })}
        aria-label={tr("Purchase 1 %s", String(name))}
      >
        +1
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={consume.isPending || amount <= 0}
        onClick={() => consume.mutate({ productId, amount: 1 })}
        aria-label={tr("Consume 1 %s", String(name))}
      >
        {tr("Consume")}
      </button>
    </>
  );
}
