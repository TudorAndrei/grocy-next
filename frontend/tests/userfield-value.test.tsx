import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { UserfieldValue } from "@/components/UserfieldValue";
import { writeApiConfig } from "@/lib/config";

test("modern links retain strict titled values, absent null controls and safe hrefs by default", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => Response.json({})),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const cases = [
    { caption: "Stored null", type: "link", value: null },
    { caption: "Numeric title", type: "link-with-title", value: '{"title":7,"link":"/docs"}' },
    { caption: "Unsafe scheme", type: "link", value: "javascript:alert(1)" },
    {
      caption: "Safe title",
      type: "link-with-title",
      value: '{"title":"Modern guide","link":"https://example.test/modern"}',
    },
  ];

  const view = render(
    <QueryClientProvider client={client}>
      <dl>
        {cases.map((item, index) => (
          <div key={item.caption}>
            <dt>{item.caption}</dt>
            <dd>
              <UserfieldValue
                field={{
                  id: index,
                  name: item.caption,
                  caption: item.caption,
                  type: item.type,
                  input_required: 0,
                  default_value: null,
                  config: null,
                }}
                value={item.value}
              />
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
  const cells = screen.getAllByRole("definition");
  expect(cells[0]!.textContent).toBe("");
  expect(cells[0]!.querySelector("a")).toBeNull();
  expect(cells[1]!.textContent).toBe("");
  expect(cells[1]!.querySelector("a")).toBeNull();
  expect(cells[2]!.textContent).toBe("javascript:alert(1)");
  expect(cells[2]!.querySelector("a")?.getAttribute("href")).toBeNull();
  expect(within(cells[3]!).getByRole("link", { name: "Modern guide" }).getAttribute("href")).toBe(
    "https://example.test/modern",
  );
});

test("modern file values still open an authenticated API blob without native named links", async () => {
  writeApiConfig({ baseUrl: "", apiKey: "modern-key" });
  const path = `/api/files/userfiles/${encodeURIComponent(btoa("generic.pdf"))}`;

  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input) === path ? new Response("modern file bytes") : Response.json({}),
  );

  vi.stubGlobal("fetch", fetchMock);
  const blobs = vi.fn(() => "blob:modern-file");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = blobs;
      static revokeObjectURL = vi.fn();
    },
  );
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const view = render(
    <QueryClientProvider client={client}>
      <UserfieldValue
        field={{
          id: 1,
          name: "manual",
          caption: "Manual",
          type: "file",
          input_required: 0,
          default_value: null,
          config: null,
        }}
        value={`${btoa("generic.pdf")}_${btoa("Generic manual.pdf")}`}
      />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });
  expect(screen.queryByRole("link")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Generic manual.pdf" }));
  await waitFor(() =>
    expect(opened).toHaveBeenCalledWith("blob:modern-file", "_blank", "noopener,noreferrer"),
  );
  const read = fetchMock.mock.calls.find(([input]) => String(input) === path);
  expect(read).toBeTruthy();
  expect(new Headers(read?.[1]?.headers).get("GROCY-API-KEY")).toBe("modern-key");
  expect(blobs).toHaveBeenCalledOnce();
});

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
