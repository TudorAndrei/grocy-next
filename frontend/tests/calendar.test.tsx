import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route } from "@/routes/calendar";

test("the agenda shows stock dates and named meals at their section time", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json([
        {
          title: "Meal plan recipe: Evening: Stew",
          start: "2027-01-04 18:15:00",
          date_format: "datetime",
        },
        { title: "Product due: Yogurt", start: "2027-01-02", date_format: "date" },
        {
          title: "Meal plan product: Evening: Bread",
          start: "2027-01-04 18:15:00",
          date_format: "datetime",
        },
        { title: "Task due: Check shelves", start: "2027-01-03", date_format: "date" },
      ]),
    ),
  );
  const Calendar = Route.options.component;

  if (!Calendar) throw new Error("The calendar route has no page.");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Calendar />
    </QueryClientProvider>,
  );
  await screen.findByText("Meal plan recipe: Evening: Stew");
  const entries = screen.getAllByRole("listitem");
  expect(entries.map((entry) => entry.lastElementChild?.textContent)).toEqual([
    "Product due: Yogurt",
    "Task due: Check shelves",
    "Meal plan recipe: Evening: Stew",
    "Meal plan product: Evening: Bread",
  ]);
  expect(entries[2]?.querySelector("time")?.dateTime).toBe("2027-01-04T18:15:00");
  expect(entries[0]?.querySelector("time")?.dateTime).toBe("2027-01-02");
  expect(entries[0]?.textContent).toContain("All day");
});

test("calendar export downloads the authenticated calendar document", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/api/calendar/ical") {
        if (!new Headers(init?.headers).has("GROCY-API-KEY")) {
          return Response.json({ error_message: "Unauthorized" }, { status: 401 });
        }

        return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
          headers: { "Content-Type": "text/calendar" },
        });
      }

      return Response.json([]);
    }),
  );
  const documents: Blob[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        documents.push(blob);

        return "blob:calendar-export";
      }
      static revokeObjectURL = vi.fn();
    },
  );
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  const Calendar = Route.options.component;

  if (!Calendar) throw new Error("The calendar route has no page.");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Calendar />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Export" }));
  await user.click(screen.getByRole("button", { name: "Download calendar" }));
  await waitFor(() => expect(downloads).toEqual(["Grocy.ics"]));
  expect(documents[0]?.type).toBe("text/calendar");
  expect(await documents[0]?.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
});
