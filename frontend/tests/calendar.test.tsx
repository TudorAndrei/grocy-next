import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route } from "@/routes/calendar";

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
