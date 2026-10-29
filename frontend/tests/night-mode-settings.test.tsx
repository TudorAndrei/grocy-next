import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { UserSettings } from "@/lib/types";

test("appearance settings control the whole app and save the legacy schedule", async () => {
  const settings: UserSettings = {
    night_mode: "off",
    show_clock_in_header: false,
    night_mode_enabled_internal: false,
    auto_night_mode_enabled: false,
    auto_night_mode_time_range_from: "20:00",
    auto_night_mode_time_range_to: "07:00",
    auto_night_mode_time_range_goes_over_midnight: true,
  };

  const writes: UserSettings[] = [];
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "tester" }]);

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/system/config") return Response.json({ MODE: "production" });

      if (path === "/api/user/settings") return Response.json(settings);

      if (path === "/api/v2/user/settings" && init?.method === "PUT") {
        const body: UserSettings = JSON.parse(String(init.body));
        writes.push(body);
        Object.assign(settings, body);

        return Response.json(body);
      }

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      return Response.json(path.includes("shopping") ? { items: [] } : []);
    }),
  );

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/settings?tab=appearance"] }),
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const user = userEvent.setup();
  const mode = await screen.findByRole("combobox", { name: "Night mode" });
  expect(screen.getByLabelText<HTMLInputElement>("From").readOnly).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Show clock in header" }));
  await user.selectOptions(mode, "on");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  await waitFor(() => expect(view.container.querySelector("time")?.dateTime).toBeTruthy());
  expect(settings.show_clock_in_header).toBe(true);
  await user.click(screen.getByRole("link", { name: "Products" }));
  await screen.findByRole("heading", { name: "Products", level: 1 });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(view.container.querySelector("time")?.dateTime).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("tab", { name: "Appearance" }));
  await user.click(await screen.findByRole("checkbox", { name: "Auto enable in time range" }));
  const from = screen.getByLabelText<HTMLInputElement>("From");
  expect(from.readOnly).toBe(false);
  await user.clear(from);
  await user.type(from, "24:00");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  expect(writes).toContainEqual({
    auto_night_mode_enabled: true,
    auto_night_mode_time_range_from: "24:00",
  });
  expect(settings.night_mode).toBe("on");
  expect(settings.night_mode_enabled_internal).toBe(false);
  expect(from.getAttribute("aria-invalid")).toBe("false");
  await user.clear(from);
  await user.type(from, "7:00");
  expect(from.getAttribute("aria-invalid")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(settings.auto_night_mode_time_range_from).toBe("7:00"));
  expect(document.documentElement.dataset.theme).toBe("light");
  view.unmount();
  client.clear();
});
