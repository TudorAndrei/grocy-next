import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

test("the separate stock-by-location destination retains selected stock contents", async () => {
  const app = mountNativeEditor(
    "/stockbylocation",
    (url) => {
      if (url === "/api/objects/locations")
        return Response.json([
          { id: 10, name: "Pantry" },
          { id: 20, name: "Cellar" },
        ]);

      if (url === "/api/objects/products") return Response.json([{ id: 7, name: "Coffee" }]);

      if (url === "/api/stock/locations/10/entries")
        return Response.json([
          { product_id: 7, amount: 2, open: 1, best_before_date: "2027-01-02" },
        ]);

      if (url === "/api/stock/locations/20/entries") return Response.json([]);

      return undefined;
    },
    { FEATURE_FLAG_STOCK: true },
  );

  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Stock by location", level: 1 });
  await screen.findByRole("option", { name: "Pantry" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "10");
  expect((await screen.findByRole("link", { name: "Coffee" })).getAttribute("href")).toBe(
    "/products/7",
  );
  expect(screen.getByText("2027-01-02")).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "20");
  await screen.findByText("No stock in this location.");
  expect(
    app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/stock/locations/20/entries"),
  ).toBe(true);
});
