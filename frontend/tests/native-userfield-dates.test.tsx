import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { CustomDataField } from "@/lib/custom-data-context";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import tamil from "./fixtures/tamil-localization.json";
import { nativeUserfieldHosts, mountNativeUserfieldsHost } from "./fixtures/native-userfield-hosts";
import { EntityManager } from "@/components/EntityManager";
import { supportDialogs } from "./fixtures/dialogs";

// Generated from SystemService.localization('ta', 'production') and available_locales.
// Only real component/UI message IDs are retained; locale/language/header data is unchanged.
// Pinned ta/component_translations.po SHA256: 229e71b729055c6b379fbc58b4b621d9a9b215a6da604b736813c9697b7f8269.
const TAMIL_DAY = "௨௦௩௦-௦௫-௦௬";
const TAMIL_TIME = "௨௦௩௦-௦௫-௦௬ ௦௭:௦௮:௦௯";

function deferredResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function dateField(
  name: string,
  type: "date" | "datetime",
  required = 1,
  now = false,
): CustomDataField {
  return {
    id: type === "date" ? 1 : 2,
    entity: "userentity-tools",
    name,
    caption: name,
    type,
    input_required: required,
    default_value: now ? "now" : null,
    config: null,
    sort_number: type === "date" ? 1 : 2,
    show_as_column_in_tables: 0,
  };
}

function mountDates(
  fields: CustomDataField[],
  options: { selected?: boolean; english?: boolean; strict?: boolean; config?: JsonObject } = {},
) {
  const load = deferredResponse();

  const entity = {
    id: 8,
    name: "tools",
    caption: "Tools",
    description: null,
    show_in_sidebar_menu: 0,
    icon_css_class: null,
  };

  const writes: { path: string; body: JsonObject }[] = [];
  const reads: { path: string; signal?: AbortSignal | null }[] = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const app = mountNativeEditor(
    `/userobject/tools/${options.selected ? "9" : "new"}?embedded`,
    (path, request) => {
      if (path.startsWith("/api/v2/localization"))
        return Response.json(
          options.english
            ? {
                locale: "en",
                direction: "ltr",
                languages: tamil.languages,
                catalog: {
                  domain: tamil.catalog.domain,
                  "plural-forms": null,
                  messages: { "": { moment_locale: ["x"] } },
                },
              }
            : tamil,
        );

      if (path === "/api/system/config")
        return Response.json({
          LOCALE: options.english ? "en" : "ta",
          FEATURE_FLAG_STOCK: false,
          FEATURE_FLAG_SHOPPINGLIST: false,
          ...options.config,
        });

      if (path === "/api/v2/custom-data/userobjects/tools")
        return Response.json({
          userentity: entity,
          fields,
          rows: options.selected ? [{ id: 9, userentity_id: 8, values: {} }] : [],
        });

      if (path === "/api/objects/userentities") return Response.json([entity]);

      if (path === "/api/objects/userobjects/9" && !request?.method)
        return Response.json({ id: 9, userentity_id: 8 });

      if (
        path === "/api/objects/userfields?query[]=entity=userentity-tools" ||
        (path === "/api/userfields/userentity-tools/9" && !request?.method)
      ) {
        reads.push({ path, signal: request?.signal });

        return load.promise.then((response) => response.clone());
      }

      if (request?.method === "POST" || request?.method === "PUT") {
        writes.push({ path, body: JSON.parse(String(request.body)) });

        return path === "/api/objects/userobjects"
          ? Response.json({ created_object_id: "41" })
          : new Response(null, { status: 204 });
      }

      return undefined;
    },
    {},
    {},
    { strictMode: options.strict },
  );

  return { ...app, load, writes, reads, errors, messages };
}

function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2030, 4, 6, 7, 8, 9));
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

test.each([
  { type: "date", name: "Native day", early: "2011-02-03", expected: TAMIL_DAY },
  { type: "datetime", name: "Native instant", early: "2011-02-03 04:05:06", expected: TAMIL_TIME },
] as const)(
  "Tamil native create $type retains callback text and sends exact localized dirty metadata",
  async ({ type, name, early, expected }) => {
    freezeClock();
    const fields = [dateField(name, type, 1, true)];
    const app = mountDates(fields);
    const input = await screen.findByLabelText<HTMLInputElement>(name);
    const form = input.closest("form")!;
    expect(input.value).toBe("");
    expect(input.matches(":disabled")).toBe(false);
    const user = userEvent.setup();
    await user.type(input, early);
    expect(input.value).toBe(early);
    await act(async () => app.load.release(Response.json(fields)));
    await waitFor(() => expect(input.value).toBe(expected));
    expect(screen.getByLabelText(name)).toBe(input);
    expect(input.closest("form")).toBe(form);
    expect(input.type).toBe("text");
    expect(input.validity.valid).toBe(true);
    await user.click(within(form).getByRole("button", { name: "சேமி" }));
    await waitFor(() =>
      expect(app.writes).toEqual([
        { path: "/api/objects/userobjects", body: { userentity_id: 8 } },
        { path: "/api/userfields/userentity-tools/41", body: { [name]: expected } },
      ]),
    );
    expect(app.errors).not.toHaveBeenCalled();
  },
);

test.each([
  { type: "date", name: "Native day", early: "2011-02-03", expected: TAMIL_DAY },
  { type: "datetime", name: "Native instant", early: "2011-02-03 04:05:06", expected: TAMIL_TIME },
] as const)(
  "Tamil native selected $type loads raw text without replacing the control or clearing dirty",
  async ({ type, name, early, expected }) => {
    freezeClock();
    const app = mountDates([dateField(name, type)], { selected: true });
    const input = await screen.findByLabelText<HTMLInputElement>(name);
    const user = userEvent.setup();
    expect(input.value).toBe("");
    await user.type(input, early);
    await act(async () => app.load.release(Response.json({ [name]: expected })));
    await waitFor(() => expect(input.value).toBe(expected));
    expect(screen.getByLabelText(name)).toBe(input);
    expect(input.required).toBe(true);
    expect(input.validity.valid).toBe(true);
    await user.click(within(input.closest("form")!).getByRole("button", { name: "சேமி" }));
    await waitFor(() =>
      expect(app.writes).toEqual([
        { path: "/api/objects/userobjects/9", body: { userentity_id: 8 } },
        { path: "/api/userfields/userentity-tools/9", body: { [name]: expected } },
      ]),
    );
  },
);

test("native required datetime rejects controlled minute-only text before blur and keeps exact seconds on Save", async () => {
  const app = mountDates([dateField("Required instant", "datetime")], {
    selected: true,
    english: true,
  });

  const input = await screen.findByLabelText<HTMLInputElement>("Required instant");
  await act(async () =>
    app.load.release(Response.json({ "Required instant": "2030-05-06 07:08:09" })),
  );
  await waitFor(() => expect(input.value).not.toBe(""));
  // Controlled direct-value/keyup submission isolates source validation before blur restoration.
  input.value = "2030-05-06 07:08";
  fireEvent.keyUp(input, { key: "q", keyCode: 81 });
  expect(input.validity.customError).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(app.writes).toEqual([]);
  input.value = "2030-05-06 07:08:09";
  fireEvent.keyUp(input, { key: "q", keyCode: 81 });
  expect(input.validity.valid).toBe(true);
  fireEvent.submit(input.closest("form")!);
  await waitFor(() =>
    expect(app.writes).toContainEqual({
      path: "/api/userfields/userentity-tools/9",
      body: { "Required instant": "2030-05-06 07:08:09" },
    }),
  );
});

test.each(["date", "datetime"] as const)(
  "native optional %s Save preserves controlled raw invalid text before blur restoration",
  async (type) => {
    const app = mountDates([dateField("Optional value", type, 0)], {
      selected: true,
      english: true,
    });

    const input = await screen.findByLabelText<HTMLInputElement>("Optional value");
    await act(async () => app.load.release(Response.json({ "Optional value": "" })));
    // This is the source's pre-blur boundary, not a claim about natural click/blur normalization.
    input.value = "raw";
    fireEvent.keyUp(input, { key: "q", keyCode: 81 });
    expect(input.value).toBe("raw");
    expect(input.validity.valid).toBe(true);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(app.writes).toContainEqual({
        path: "/api/userfields/userentity-tools/9",
        body: { "Optional value": "raw" },
      }),
    );
  },
);

test("mixed native custom datetime keyup validates the first date and a later Load retains that error", async () => {
  freezeClock();

  const fields = [
    dateField("First day", "date", 1, true),
    dateField("Later instant", "datetime", 1, true),
  ];

  const app = mountDates(fields, { english: true });
  const day = await screen.findByLabelText<HTMLInputElement>("First day");
  const instant = screen.getByLabelText<HTMLInputElement>("Later instant");
  day.value = "2011-02-03";
  instant.value = "2012-03-04 05:06:07";
  fireEvent.keyUp(instant, { key: "q", keyCode: 81 });
  expect(day.validity.customError).toBe(true);
  expect(instant.validity.customError).toBe(false);
  await act(async () => app.load.release(Response.json(fields)));
  await waitFor(() => expect(day.value).toBe("2030-05-06"));
  expect(instant.value).toBe("2030-05-06 07:08:09");
  expect(day.validity.customError).toBe(true);
  fireEvent.submit(day.closest("form")!);
  expect(app.writes).toEqual([]);
});

test("Tamil native custom date opens the real translated calendar and retirement removes it", async () => {
  freezeClock();
  const fields = [dateField("Native day", "date", 1, true)];
  const app = mountDates(fields);
  const input = await screen.findByLabelText<HTMLInputElement>("Native day");
  await act(async () => app.load.release(Response.json(fields)));
  await waitFor(() => expect(input.value).toBe(TAMIL_DAY));
  await userEvent.click(screen.getByRole("button", { name: "Native day: நாட்காட்டி" }));
  const calendar = await screen.findByRole("dialog", { name: "Native day: நாட்காட்டி" });
  expect(within(calendar).getByText("மே ௨௦௩௦")).toBeTruthy();
  await act(async () => app.router.navigate({ href: "/settings" }));
  await screen.findByRole("heading", { name: "Settings", level: 1 });
  expect(screen.queryByRole("dialog", { name: "Native day: நாட்காட்டி" })).toBeNull();
});

test.each([
  { english: false, firstDay: "1", weeks: "0", headers: ["தி", "செ", "பு", "வி", "வெ", "ச", "ஞா"] },
  {
    english: true,
    firstDay: "0",
    weeks: "arbitrary",
    headers: ["#", "Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  },
])(
  "native calendar settings apply first day $firstDay and week flag $weeks",
  async ({ english, firstDay, weeks, headers }) => {
    freezeClock();
    const fields = [dateField("Configured day", "date", 1, true)];

    const app = mountDates(fields, {
      english,
      config: { CALENDAR_FIRST_DAY_OF_WEEK: firstDay, CALENDAR_SHOW_WEEK_OF_YEAR: weeks },
    });

    const input = await screen.findByLabelText<HTMLInputElement>("Configured day");
    await act(async () => app.load.release(Response.json(fields)));
    await waitFor(() => expect(input.value).toBe(english ? "2030-05-06" : TAMIL_DAY));
    const label = `Configured day: ${english ? "Calendar" : "நாட்காட்டி"}`;
    await userEvent.click(screen.getByRole("button", { name: label }));
    const calendar = await screen.findByRole("dialog", { name: label });
    expect(
      within(calendar)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(headers);
  },
);

test.each(nativeUserfieldHosts)(
  "$route exposes the shared native custom date capability",
  async (host) => {
    const app = mountNativeUserfieldsHost(host);
    const day = await app.ready();
    const instant = screen.getByLabelText<HTMLInputElement>("Created time");
    expect(day.type).toBe("text");
    expect(instant.type).toBe("text");
    expect(screen.getByRole("button", { name: "Created day: Calendar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Created time: Calendar" })).toBeTruthy();

    if (host.namespace === "chores_log" || host.namespace === "battery_charge_cycles") {
      expect(day.value).toBe("");
      expect(app.definitionReads).toEqual([]);
      expect(app.reads.some((read) => read.path.startsWith("/api/userfields/"))).toBe(false);
    }
  },
);

test.each(
  nativeUserfieldHosts.filter((host) =>
    ["/purchase", "/inventory", "/stockentry/51"].includes(host.route),
  ),
)(
  "$route main purchased date participates in native custom initialization and collection shortcuts",
  async (host) => {
    freezeClock();
    const app = mountNativeUserfieldsHost(host, { showPurchased: true });
    const day = await app.ready();
    const purchased = screen.getByLabelText<HTMLInputElement>("Purchased date");
    const instant = screen.getByLabelText<HTMLInputElement>("Created time");
    const initial = host.route === "/stockentry/51" ? "2028-02-03" : "2030-05-06";
    await waitFor(() => expect(day.value).toBe(initial));
    expect(purchased.value).toBe(initial);
    expect(instant.value).toBe(`${initial} 00:00:00`);
    day.value = "+1d";
    fireEvent.keyUp(day, { key: "d", keyCode: 68 });
    expect(purchased.value).toBe("2030-05-07");
    expect(day.value).toBe("2030-05-07");
    expect(instant.value).toBe("2030-05-07");
  },
);

test.each([false, true])(
  "native custom date shortcuts retain the actual document locale (English=%s)",
  async (english) => {
    freezeClock();
    const field = dateField("Shortcut day", "date");
    const app = mountDates([field], { english });
    const input = await screen.findByLabelText<HTMLInputElement>("Shortcut day");
    await act(async () => app.load.release(Response.json([field])));
    input.value = "+1d";
    fireEvent.keyUp(input, { key: "d", keyCode: 68 });
    expect(input.value).toBe(english ? "2030-05-07" : "௨௦௩௦-௦௫-௦௭");
    fireEvent.keyUp(input, { key: "ArrowUp", keyCode: 38 });
    expect(input.value).toBe(english ? "2030-05-06" : TAMIL_DAY);
    input.value = "x";
    fireEvent.keyUp(input, { key: "x", keyCode: 88 });
    expect(input.value).toBe(english ? "2999-12-31" : "௨௯௯௯-௧௨-௩௧");
  },
);

test("the actual generic EntityManager keeps HTML date controls and its existing wire adapter", async () => {
  supportDialogs();

  const fields = [
    { ...dateField("Generic day", "date"), entity: "locations" },
    { ...dateField("Generic instant", "datetime"), entity: "locations" },
  ];

  const metadata: JsonObject[] = [];
  const reads: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/v2/custom-data/fields") return Response.json(fields);

      if (path === "/api/objects/locations")
        return Response.json([
          {
            id: 1,
            name: "Shelf",
            userfields: { "Generic day": "2030-05-06", "Generic instant": "2030-05-06 07:08:09" },
          },
        ]);

      if (path === "/api/objects/locations/1" && init?.method === "PUT")
        return new Response(null, { status: 204 });

      if (path === "/api/userfields/locations/1" && init?.method === "PUT") {
        metadata.push(JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      if (path.startsWith("/api/userfields/") && !init?.method) reads.push(path);

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EntityManager entity="locations" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Edit.*Shelf/ }));
  const day = screen.getByLabelText<HTMLInputElement>("Generic day");
  const instant = screen.getByLabelText<HTMLInputElement>("Generic instant");
  expect(day.type).toBe("date");
  expect(instant.type).toBe("datetime-local");
  expect(instant.value).toBe("2030-05-06T07:08:09");
  expect(screen.queryByRole("button", { name: "Generic day: Calendar" })).toBeNull();
  fireEvent.change(day, { target: { value: "2031-06-07" } });
  fireEvent.change(instant, { target: { value: "2031-06-07T08:09:10" } });
  await user.click(screen.getByRole("button", { name: "Save location" }));
  await waitFor(() =>
    expect(metadata).toEqual([
      { "Generic day": "2031-06-07" },
      { "Generic instant": "2031-06-07 08:09:10" },
    ]),
  );
  expect(reads).toEqual([]);
});
