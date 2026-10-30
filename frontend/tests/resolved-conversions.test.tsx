import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, onTestFinished } from "vitest";
import { ResolvedConversions } from "@/components/ResolvedConversions";
import { writeApiConfig } from "@/lib/config";

function mount(fail = false) {
  writeApiConfig({ baseUrl: "/house", apiKey: "resolved-key" });

  const units = [
    { id: 1, name: "Piece", name_plural: "Pieces", plural_forms: null },
    { id: 2, name: "Box", name_plural: "Boxes", plural_forms: null },
    { id: 3, name: "Case", name_plural: "Cases", plural_forms: null },
  ];

  const rows = [
    { id: 1, from_qu_id: 1, to_qu_id: 2, factor: "2" },
    { id: 2, from_qu_id: 1, to_qu_id: 3, factor: "10" },
    { id: 3, from_qu_id: 2, to_qu_id: 1, factor: "0.5" },
    { id: 4, from_qu_id: 4, to_qu_id: 2, factor: "3" },
  ];

  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");

      if (url.pathname === "/house/api/user/settings")
        return Response.json({ stock_decimal_places_amounts: 2 });

      if (
        url.pathname.startsWith("/house/api/user/settings/") &&
        ["PUT", "DELETE"].includes(init?.method ?? "GET")
      )
        return new Response(null, { status: 204 });

      if (url.pathname === "/house/api/v2/quantity-unit-conversions/resolved") {
        expect(url.searchParams.get("product")).toBe("7");

        if (fail && ++reads === 1)
          return Response.json({ error_message: "Cache read failed" }, { status: 503 });

        return Response.json({ product: { id: 7, name: "Tea" }, units, rows });
      }

      throw new Error(`Unexpected ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onTestFinished(() => client.clear());
  render(
    <QueryClientProvider client={client}>
      <ResolvedConversions product="7" />
    </QueryClientProvider>,
  );
}

test("resolved conversions filter From only and keep native factor text order", async () => {
  mount();
  const user = userEvent.setup();
  const table = within(await screen.findByRole("table", { name: "QU conversions resolved" }));
  expect(
    table.getByRole("row", { name: "Box Piece 0.5 This means 1 Box is the same as 0.5 Pieces" }),
  ).toBeTruthy();
  expect(
    table.getByRole("row", { name: "Box 3 This means 1 is the same as 3 Boxes" }),
  ).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Quantity unit"), "2");
  expect(table.getAllByRole("row").length).toBe(2);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.click(table.getByRole("button", { name: "Factor" }));
  expect(
    table
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[2]?.textContent),
  ).toEqual(["0.5", "10", "2", "3"]);
});

test("resolved conversions retry a failed cache read with usable unit filters", async () => {
  mount(true);
  const user = userEvent.setup();
  await screen.findByText("Cache read failed");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText("Cache read failed")).toBeNull());
  const table = within(await screen.findByRole("table", { name: "QU conversions resolved" }));
  expect(table.getAllByRole("row").length).toBe(5);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "QU conversions resolved" }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Quantity unit"), "2");
  expect(table.getAllByRole("row").length).toBe(2);
  expect(
    table.getByRole("row", { name: "Box Piece 0.5 This means 1 Box is the same as 0.5 Pieces" }),
  ).toBeTruthy();
});
