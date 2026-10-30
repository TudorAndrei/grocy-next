import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route } from "@/routes/household";

test("a past chore execution keeps the time entered in the form", async () => {
  let savedTime = "";
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/chores/1/execute") {
        const body = JSON.parse(String(init?.body));
        savedTime = body.tracked_time;

        return Response.json({ id: 1 });
      }

      if (path === "/api/objects/chores") {
        return Response.json([{ id: 1, name: "Water plants", period_type: "manually", active: 1 }]);
      }

      return Response.json([]);
    }),
  );
  const Household = Route.options.component;

  if (!Household) throw new Error("The household route has no page.");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Household />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Record execution" }));
  fireEvent.change(screen.getByLabelText("Recorded time"), {
    target: { value: "2020-01-02T03:04" },
  });
  await user.click(screen.getByRole("button", { name: "Save record" }));
  await waitFor(() => expect(savedTime).toBe("2020-01-02 03:04:00"));
});
