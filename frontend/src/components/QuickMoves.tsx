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
          aria-label={`Purchase ${name}`}
        >
          Purchase…
        </Link>
        <Link
          to="/products/$productId"
          params={params}
          search={{ move: "consume" }}
          className="btn btn-sm"
          aria-disabled={amount <= 0}
          aria-label={`Consume ${name}`}
        >
          Consume…
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
        aria-label={`Purchase 1 ${name}`}
      >
        +1
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={consume.isPending || amount <= 0}
        onClick={() => consume.mutate({ productId, amount: 1 })}
        aria-label={`Consume 1 ${name}`}
      >
        Consume
      </button>
    </>
  );
}
