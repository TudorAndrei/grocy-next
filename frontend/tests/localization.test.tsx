import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { LocalizationProvider } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { EntityManager } from "@/components/EntityManager";

test("the saved language translates navigation and can be changed without changing field values", async () => {
  let locale = "de";
  let saved: Record<string, string> | undefined;
  localStorage.setItem("grocy_next_theme", "light");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "German household" }]);

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/system/config") return Response.json({ LOCALE: locale });

      if (path === "/api/user/settings")
        return Response.json({ locale, stock_default_purchase_amount: 2 });

      if (path === "/api/v2/user/settings" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));
        locale = saved?.locale ?? locale;

        return Response.json(saved);
      }

      if (path.startsWith("/api/v2/localization")) {
        const language = new URL(path, "http://localhost").searchParams.get("locale") ?? "de";

        const translations =
          language === "ru"
            ? {
                Settings: ["Настройки"],
                Products: ["Продукты"],
                Language: ["Язык"],
                de: ["Немецкий"],
                ru: ["Русский"],
              }
            : {
                Settings: ["Einstellungen"],
                Products: ["Produkte"],
                Language: ["Sprache"],
                Next: ["Weiter"],
                de: ["Deutsch"],
                ru: ["Russisch"],
              };

        return Response.json({
          locale: language,
          direction: "ltr",
          languages: ["de", "ru"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: { "": translations },
          },
        });
      }

      return Response.json(path.includes("shopping") ? { items: [] } : []);
    }),
  );

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings?tab=preferences"] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Einstellungen" });
  await screen.findByRole("link", { name: "Produkte" });
  expect(document.documentElement.lang).toBe("de");
  expect(screen.getByRole("link", { name: "Grocy Next, Home" }).textContent).toContain(
    "Grocy Next",
  );
  const language = screen.getByRole<HTMLSelectElement>("combobox", { name: "Sprache" });
  expect(language.value).toBe("de");
  expect(screen.getByLabelText<HTMLInputElement>("Default amount for purchase").value).toBe("2");
  const user = userEvent.setup();
  await user.selectOptions(language, "ru");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "Настройки" });
  await screen.findByRole("link", { name: "Продукты" });
  await waitFor(() => expect(saved).toEqual({ locale: "ru" }));
  expect(screen.getByLabelText<HTMLInputElement>("Default amount for purchase").value).toBe("2");
  expect(document.documentElement.lang).toBe("ru");
});

test("Hebrew labels retain user names, custom captions, and saved unit forms", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({ LOCALE: "he_IL" });

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "he_IL",
          direction: "rtl",
          languages: ["en", "he_IL"],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: {
              "": {
                Settings: ["הגדרות"],
                Units: ["יחידות"],
                Name: ["שם"],
                Edit: ["עריכה"],
                "Plural forms": ["צורות רבים"],
              },
            },
          },
        });

      if (path === "/api/objects/quantity_units")
        return Response.json([
          {
            id: 1,
            name: "Settings",
            name_plural: "Settings plural",
            plural_forms: "штуки\nштук",
            userfields: { caption: "Saved text" },
          },
        ]);

      if (path === "/api/objects/userfields")
        return Response.json([
          {
            id: 1,
            entity: "quantity_units",
            name: "caption",
            caption: "Settings",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
          },
        ]);

      return Response.json([]);
    }),
  );

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalizationProvider>
        <PageHeader title="Settings" />
        <EntityManager entity="quantity_units" />
      </LocalizationProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "יחידות" });
  expect(document.documentElement.lang).toBe("he-IL");
  expect(document.documentElement.dir).toBe("rtl");
  expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^עריכה/ }));
  expect(screen.getByLabelText<HTMLInputElement>("שם").value).toBe("Settings");
  expect(screen.getByLabelText<HTMLInputElement>("Settings").value).toBe("Saved text");
  expect(screen.getByLabelText<HTMLTextAreaElement>("צורות רבים").value).toBe("штуки\nштук");
});
