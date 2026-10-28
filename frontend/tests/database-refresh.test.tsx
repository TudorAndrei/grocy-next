import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DatabaseRefresh } from "@/components/DatabaseRefresh";
import { api } from "@/lib/api";

function StockAmount() {
  const stock = useQuery({ queryKey: ["stock", 1], queryFn: () => api.getStockProduct(1) });

  return <output aria-label="Stock amount">{stock.data?.stock_amount}</output>;
}

test("automatic refresh shows a stock change made outside the page", async () => {
  vi.useFakeTimers();
  let amount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) =>
      String(input) === "/api/user/settings"
        ? Response.json({ auto_reload_on_db_change: "1" })
        : Response.json({ stock_amount: amount }),
    ),
  );

  try {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DatabaseRefresh />
        <StockAmount />
      </QueryClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByLabelText("Stock amount").textContent).toBe("0");
    amount = 3;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByLabelText("Stock amount").textContent).toBe("3");
    document.body.classList.add("fullscreen-card");
    amount = 5;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByLabelText("Stock amount").textContent).toBe("3");
    document.body.classList.remove("fullscreen-card");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByLabelText("Stock amount").textContent).toBe("5");
  } finally {
    document.body.classList.remove("fullscreen-card");
    vi.useRealTimers();
  }
});
