import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";
import { UserfieldValue } from "@/components/UserfieldValue";

test.each([
  { type: "number-decimal", expected: ["", "", "13", "NaN", "-1", "0"] },
  { type: "number-currency", expected: ["", "", "€12.750", "€NaN", "-€1.250", "€0.000"] },
])(
  "$type displays empty and partially numeric values like the reference",
  async ({ type, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        Response.json(
          String(input) === "/api/system/config"
            ? { CURRENCY: "EUR" }
            : { stock_decimal_places_prices_display: 3 },
        ),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const field = {
      id: 1,
      name: "amount",
      caption: "Amount",
      type,
      input_required: 0,
      default_value: null,
      config: null,
    };

    const view = render(
      <QueryClientProvider client={client}>
        <dl>
          {[null, "", "12.75tail", " ", "-1.25", "0"].map((value) => (
            <div key={String(value)}>
              <dt>{JSON.stringify(value)}</dt>
              <dd>
                <UserfieldValue field={field} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </QueryClientProvider>,
    );

    onTestFinished(() => {
      view.unmount();
      client.clear();
    });
    await waitFor(() =>
      expect(screen.getAllByRole("definition").map((element) => element.textContent)).toEqual(
        expected,
      ),
    );
  },
);
