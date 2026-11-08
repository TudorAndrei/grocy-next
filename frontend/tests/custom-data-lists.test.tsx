import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import type { JsonObject } from "@/lib/json";

const manual = `${btoa("fixed-internal.pdf")}_${btoa("Visible manual.pdf")}_extra`;
const photo = `${btoa("fixed-image.png")}_${btoa("Visible picture.png")}_extra`;

function mount(
  path: string,
  {
    heldDelete = false,
    basepath = "/",
    files = false,
    links,
    config = {},
  }: {
    heldDelete?: boolean;
    basepath?: string;
    files?: boolean;
    links?: "targets" | "presence";
    config?: JsonObject;
  } = {},
) {
  const entities = [
    {
      id: 1,
      name: "car",
      caption: "Cars",
      description: "Garage",
      show_in_sidebar_menu: 1,
      icon_css_class: "fa-solid fa-car",
    },
    {
      id: 2,
      name: "cargo",
      caption: "Cargo",
      description: null,
      show_in_sidebar_menu: 0,
      icon_css_class: null,
    },
  ];

  const fields = [
    {
      ...notesField("products"),
      id: 1,
      name: "color",
      caption: "Product color",
      sort_number: null,
      show_as_column_in_tables: 1,
    },
    {
      ...notesField("userentity-car"),
      id: 2,
      name: "name",
      caption: "Car label",
      sort_number: 1,
      show_as_column_in_tables: 1,
    },
    {
      ...notesField("userentity-car"),
      id: 3,
      name: "private",
      caption: "Hidden note",
      sort_number: 2,
      show_as_column_in_tables: 0,
    },
    {
      ...notesField("userentity-cargo"),
      id: 4,
      name: "name",
      caption: "Cargo label",
      sort_number: "",
      show_as_column_in_tables: 1,
    },
  ];

  const rows: { id: number; userentity_id: number; values: Record<string, string | null> }[] = [
    { id: 10, userentity_id: 1, values: { name: "Ford", private: "Do not search" } },
    { id: 20, userentity_id: 1, values: { name: "Volvo", private: "" } },
  ];

  if (files) {
    fields.push(
      {
        ...notesField("userentity-car"),
        id: 5,
        name: "manual",
        caption: "Manual",
        type: "file",
        sort_number: 3,
        show_as_column_in_tables: 1,
      },
      {
        ...notesField("userentity-car"),
        id: 6,
        name: "photo",
        caption: "Photo",
        type: "image",
        sort_number: 4,
        show_as_column_in_tables: 1,
      },
    );
    Object.assign(rows[0]!.values, { manual, photo });
    Object.assign(rows[1]!.values, { manual: "", photo: "" });
    rows.push(
      { id: 30, userentity_id: 1, values: { name: "Null bindings", manual: null, photo: null } },
      { id: 40, userentity_id: 1, values: { name: "Missing bindings" } },
      { id: 50, userentity_id: 1, values: { name: "Zero bindings", manual: "0", photo: "0" } },
      {
        id: 60,
        userentity_id: 1,
        values: {
          name: "Opaque internal metadata",
          manual: `!_${btoa("Display only.pdf")}_extra`,
          photo: `!_${btoa("Display only.png")}_extra`,
        },
      },
      {
        id: 70,
        userentity_id: 1,
        values: {
          name: "UTF8 metadata",
          manual: `${btoa("utf8.pdf")}_${btoa(String.fromCharCode(...new TextEncoder().encode("Über manual.pdf")))}_extra`,
          photo: `${btoa("utf8.png")}_${btoa(String.fromCharCode(...new TextEncoder().encode("Über picture.png")))}_extra`,
        },
      },
    );
  }

  if (links) {
    fields.push({
      ...notesField("userentity-car"),
      id: 7,
      name: "website",
      caption: "Website",
      type: "link-with-title",
      sort_number: 3,
      show_as_column_in_tables: 1,
    });

    if (links === "targets") {
      rows[0]!.values.website = JSON.stringify({
        title: "Same label",
        link: "https://example.test/z",
      });
      rows[1]!.values.website = JSON.stringify({
        title: "Same label",
        link: "https://example.test/a",
      });
    } else {
      fields.push({
        ...notesField("userentity-car"),
        id: 8,
        name: "plain",
        caption: "Plain link",
        type: "link",
        sort_number: 4,
        show_as_column_in_tables: 1,
      });
      Object.assign(rows[0]!.values, { website: null, plain: null });
      rows.push(
        { id: 30, userentity_id: 1, values: { name: "Empty link", website: "", plain: "" } },
        { id: 40, userentity_id: 1, values: { name: "Zero link", website: "0", plain: "0" } },
      );
    }
  }

  const writes: string[] = [];
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/objects/userentities") return Response.json(entities);

      if (url === "/api/objects/userfields") return Response.json(fields);

      if (url === "/api/v2/custom-data/catalog")
        return Response.json({
          entities: ["products", "userentity-car", "userentity-cargo", "users"],
          field_types: ["text-single-line", "checkbox"],
        });

      if (url === "/api/v2/custom-data/userobjects/car")
        return Response.json({
          userentity: entities[0],
          fields: fields.filter((field) => field.entity === "userentity-car"),
          rows,
        });

      if (init?.method === "DELETE" && url.startsWith("/api/objects/")) {
        writes.push(url);

        if (heldDelete) await held;
        const id = Number(url.split("/").at(-1));

        const selected = url.includes("userobjects")
          ? rows
          : url.includes("userentities")
            ? entities
            : fields;

        const index = selected.findIndex((row) => row.id === id);

        if (index >= 0) selected.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    config,
    { basepath },
  );

  return { ...app, fields, entities, rows, writes, release };
}

test("native titled links retain distinct target sorting, search and clickable group identities", async () => {
  const app = mount("/userobjects/car", { links: "targets" });
  await screen.findByText("Ford");
  const table = screen.getByRole("table", { name: "Cars" });

  const names = () =>
    within(table)
      .getAllByRole("link", { name: "Edit this item" })
      .map((link) => within(link.closest("tr")!).getAllByRole("cell")[1]!.textContent);

  const user = userEvent.setup();
  expect(names()).toEqual(["Ford", "Volvo"]);
  await user.click(within(table).getByRole("button", { name: "Website" }));
  expect(names()).toEqual(["Volvo", "Ford"]);
  const search = screen.getByRole("searchbox", { name: "Search" });
  await user.type(search, "https://example.test/a");
  expect(names()).toEqual(["Volvo"]);
  await user.clear(search);
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Website" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  const headers = [...table.querySelectorAll<HTMLTableRowElement>("tr.stock-table-group")];
  expect(headers).toHaveLength(2);

  const targets = headers.map((header) =>
    within(header).getByRole<HTMLAnchorElement>("link", { name: "Same label" }),
  );

  expect(targets.map((link) => link.getAttribute("href"))).toEqual([
    "https://example.test/a",
    "https://example.test/z",
  ]);
  expect(targets.map((link) => link.target)).toEqual(["_blank", "_blank"]);
  await user.click(targets[0]!);
  expect(names()).toEqual(["Ford"]);

  const toggles = headers.map((header) =>
    within(header).getByRole("button", { name: "Group: Same label" }),
  );

  expect(toggles.map((button) => button.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
  await user.click(toggles[0]!);
  await user.click(toggles[1]!);
  expect(names()).toEqual(["Volvo"]);
  expect(toggles.map((button) => button.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
  expect(app.writes).toEqual([]);
});

test("native plain and titled links distinguish stored empty anchors from absent fields", async () => {
  mount("/userobjects/car", { links: "presence" });
  await screen.findByText("Ford");

  for (const name of ["Ford", "Empty link", "Zero link", "Volvo"]) {
    const row = screen.getByText(name).closest("tr")!;
    const [titled, plain] = within(row).getAllByRole("cell").slice(-2);

    if (name === "Volvo") {
      expect(titled!.querySelector("a")).toBeNull();
      expect(plain!.querySelector("a")).toBeNull();
    } else {
      const titleLink = titled!.querySelector("a");
      expect(titleLink).not.toBeNull();
      expect(titleLink!.getAttribute("href")).toBe("");
      expect(titleLink!.textContent).toBe("");
      const plainLink = plain!.querySelector("a");
      expect(plainLink).not.toBeNull();
      expect(plainLink!.getAttribute("href")).toBe(name === "Zero link" ? "0" : "");
      expect(plainLink!.textContent).toBe(name === "Zero link" ? "0" : "");
      expect([titleLink!.target, plainLink!.target]).toEqual(["_blank", "_blank"]);
    }
  }

  const table = screen.getByRole("table", { name: "Cars" });
  const user = userEvent.setup();
  await user.click(within(table).getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  await user.click(within(options).getByRole("radio", { name: "Website" }));
  await user.click(within(options).getByRole("button", { name: "OK" }));
  const headers = [...table.querySelectorAll<HTMLTableRowElement>("tr.stock-table-group")];
  expect(headers).toHaveLength(2);
  expect(headers.map((header) => header.querySelectorAll("a").length).sort()).toEqual([0, 1]);
});

test("native userobjects render packed named files and open picture links as form dialogs including Ctrl-click", async () => {
  const blobs = vi.fn(() => "blob:unexpected-native-file");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = blobs;
      static revokeObjectURL = vi.fn();
    },
  );
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);

  const app = mount("/userobjects/car", {
    files: true,
    config: { BASE_URL: "https://example.test/house.hold/", DISABLE_URL_REWRITING: true },
  });

  const row = (await screen.findByText("Ford")).closest("tr")!;
  const file = within(row).getByRole<HTMLAnchorElement>("link", { name: "Visible manual.pdf" });
  const prefix = "https://example.test/house.hold/index.php/files/userfiles/";
  expect(file.getAttribute("href")).toBe(prefix + manual);
  expect(file.target).toBe("_blank");
  const picture = within(row).getByRole<HTMLImageElement>("img", { name: "Visible picture.png" });
  const link = within(row).getByRole<HTMLAnchorElement>("link", { name: "Visible picture.png" });
  const url = `${prefix}${photo}?force_serve_as=picture`;
  expect(link.getAttribute("href")).toBe(url);
  expect(link.classList.contains("show-as-dialog-link")).toBe(true);
  expect(picture.getAttribute("src")).toBe(`${url}&best_fit_width=32&best_fit_height=32`);
  expect(picture.title).toBe("Visible picture.png");
  expect(picture.getAttribute("loading")).toBe("lazy");
  expect(picture.classList.contains("entity-picture")).toBe(false);
  expect(picture.hasAttribute("width")).toBe(false);
  expect(picture.hasAttribute("height")).toBe(false);
  const clicks: MouseEvent[] = [];

  const observe = (event: MouseEvent) => {
    if (event.target === file || event.target === picture) clicks.push(event);
  };

  document.addEventListener("click", observe, true);
  onTestFinished(() => document.removeEventListener("click", observe, true));
  const user = userEvent.setup();
  await user.click(file);
  expect(clicks[0]?.defaultPrevented).toBe(false);

  for (const ctrl of [false, true]) {
    if (ctrl) await user.keyboard("{Control>}");
    await user.click(picture);

    if (ctrl) await user.keyboard("{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Details" });
    expect(dialog.classList.contains("form")).toBe(true);
    expect(within(dialog).getByTitle<HTMLIFrameElement>("Details").getAttribute("src")).toBe(url);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
  }

  expect(
    clicks.map((event) => ({ ctrl: event.ctrlKey, prevented: event.defaultPrevented })),
  ).toEqual([
    { ctrl: false, prevented: false },
    { ctrl: false, prevented: true },
    { ctrl: true, prevented: true },
  ]);
  const search = screen.getByRole("searchbox", { name: "Search" });

  for (const term of [btoa("fixed-internal.pdf"), prefix + manual]) {
    await user.clear(search);
    await user.type(search, term);
    expect(screen.getByText("Ford")).toBeTruthy();
    expect(screen.queryByText("Volvo")).toBeNull();
  }

  await user.clear(search);
  await user.type(search, "Visible picture.png");
  expect(screen.queryByText("Ford")).toBeNull();
  expect(blobs).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
  expect(app.fetchMock.mock.calls.filter(([path]) => String(path).includes("/api/files/"))).toEqual(
    [],
  );
});

test("native file table cells preserve blank and zero values and PHP display-only UTF8 decoding", async () => {
  const app = mount("/userobjects/car", { files: true });
  await screen.findByText("Ford");

  for (const name of ["Volvo", "Null bindings", "Missing bindings", "Zero bindings"]) {
    const row = screen.getByText(name).closest("tr")!;
    const cells = within(row).getAllByRole("cell").slice(-2);
    expect(cells).toHaveLength(2);

    for (const cell of cells) {
      expect(cell.textContent).toBe(name === "Zero bindings" ? "0" : "");
      expect(within(cell).queryByRole("link")).toBeNull();
      expect(within(cell).queryByRole("button")).toBeNull();
      expect(within(cell).queryByRole("img")).toBeNull();
    }
  }

  for (const [name, display, image] of [
    ["Opaque internal metadata", "Display only.pdf", "Display only.png"],
    ["UTF8 metadata", "Über manual.pdf", "Über picture.png"],
  ]) {
    const row = screen.getByText(name!).closest("tr")!;
    expect(within(row).getByRole("link", { name: display! })).toBeTruthy();
    const picture = within(row).getByRole<HTMLImageElement>("img", { name: image! });
    expect(picture.title).toBe(image);
  }

  expect(app.fetchMock.mock.calls.filter(([path]) => String(path).includes("/api/files/"))).toEqual(
    [],
  );
});

test("native userfields list honors partial entity filtering and its stale Add target after Clear", async () => {
  const app = mount("/userfields?entity=userentity-car");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Userfields", level: 1 });
  await screen.findByText("Car label");
  expect(screen.getByText("Cargo label")).toBeTruthy();
  expect(screen.queryByText("Product color")).toBeNull();
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toContain(
    "entity=userentity-car",
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Entity" }), "products");
  expect(screen.getByText("Product color")).toBeTruthy();
  expect(screen.queryByText("Car label")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByText("Car label")).toBeTruthy();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Entity" }).value).toBe("all");
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toContain(
    "entity=products",
  );
  expect(app.router.history.location.search).toBe("?entity=userentity-car");
});

test("native userentity list exposes selected editors and namespace configuration", async () => {
  mount("/userentities");
  await screen.findByRole("heading", { name: "Userentities", level: 1 });
  const row = (await screen.findByRole("rowheader", { name: "car" })).closest("tr")!;
  expect(within(row).getByText("Cars")).toBeTruthy();
  expect(within(row).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toContain(
    "/userentity/1?embedded",
  );
  expect(
    within(row).getByRole("link", { name: "Configure fields" }).getAttribute("href"),
  ).toContain("entity=userentity-car");
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toContain(
    "/userentity/new?embedded",
  );
});

test("native userobjects use only the selected namespace's displayed custom columns", async () => {
  mount("/userobjects/car");
  await screen.findByRole("heading", { name: "Cars", level: 1 });
  const row = (await screen.findByText("Ford")).closest("tr")!;
  expect(screen.getByRole("columnheader", { name: "Car label" })).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
  expect(screen.queryByText("Hidden note")).toBeNull();
  expect(screen.queryByText("Cargo label")).toBeNull();
  expect(within(row).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toContain(
    "/userobject/car/10?embedded",
  );
  expect(screen.getByRole("link", { name: "Configure fields" }).getAttribute("href")).toContain(
    "entity=userentity-car",
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Do not search");
  expect(screen.queryByText("Ford")).toBeNull();
});

test("deleting a selected custom object reloads the namespace and respects cancellation", async () => {
  const app = mount("/userobjects/car");
  const user = userEvent.setup();
  const row = (await screen.findByText("Ford")).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(within(dialog).getByText("Are you sure you want to delete this userobject?")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "No" }));
  expect(app.writes).toEqual([]);
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(screen.queryByText("Ford")).toBeNull());
  expect(await screen.findByText("Volvo")).toBeTruthy();
  expect(app.writes).toEqual(["/api/objects/userobjects/10"]);
});

test("a pending custom-object deletion cannot navigate after its owner leaves", async () => {
  const app = mount("/userobjects/car", { heldDelete: true });
  const user = userEvent.setup();
  const row = (await screen.findByText("Ford")).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(screen.queryByRole("dialog", { name: "Delete this item" })).toBeNull();
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Volvo");
  expect(screen.getByText("Volvo")).toBeTruthy();
  await act(async () => {
    await app.router.navigate({ to: "/settings", search: { tab: "connection" } });
  });
  await act(async () => {
    app.release();
  });
  expect(app.router.state.location.pathname).toBe("/settings");
});

test.each([
  { query: "entity=all", selected: "all", add: "" },
  { query: "entity=bogus", selected: "", add: "" },
  { query: "entity", selected: "", add: "" },
  { query: "entity=", selected: "all", add: null },
  {
    query: "entity=userentity-car&entity=products",
    selected: "userentity-car",
    add: "userentity-car",
  },
])(
  "native field bookmarks preserve first raw entity semantics: $query",
  async ({ query, selected, add }) => {
    mount("/userfields?" + query);
    await screen.findByText("Car label");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Entity" }).value).toBe(
      selected,
    );
    const target = new URL(screen.getByRole<HTMLAnchorElement>("link", { name: "Add" }).href);
    expect(target.searchParams.get("entity")).toBe(add);
    expect(screen.getByText("Cargo label")).toBeTruthy();
    expect(screen.queryByText("Product color") !== null).toBe(selected !== "userentity-car");
  },
);

test("custom entities appear in navigation with literal captions and configured icons even without stock", async () => {
  mount("/userobjects/car");
  await screen.findByRole("heading", { name: "Cars", level: 1 });
  const nav = within(screen.getByRole("navigation", { name: "Primary" }));
  const link = await nav.findByRole("link", { name: "Cars" });
  expect(link.getAttribute("href")).toBe("/userobjects/car");
  expect(link.querySelector("i")?.classList.contains("fa-car")).toBe(true);
  expect(nav.queryByRole("link", { name: "Cargo" })).toBeNull();
  await userEvent.setup().click(nav.getByRole("button", { name: "Manage master data" }));
  expect(nav.getByRole("link", { name: "Userfields" }).getAttribute("href")).toBe("/userfields");
  expect(nav.getByRole("link", { name: "Userentities" }).getAttribute("href")).toBe(
    "/userentities",
  );
});

test("namespace links preserve a configured frontend prefix", async () => {
  mount("/house/userobjects/car", { basepath: "/house" });
  await screen.findByText("Ford");
  const row = screen.getByText("Ford").closest("tr")!;
  expect(within(row).getByRole("link", { name: "Edit this item" }).getAttribute("href")).toBe(
    "/house/userobject/car/10?embedded=",
  );
  const nav = within(screen.getByRole("navigation", { name: "Primary" }));
  expect(nav.getByRole("link", { name: "Cars" }).getAttribute("href")).toBe(
    "/house/userobjects/car",
  );
});
