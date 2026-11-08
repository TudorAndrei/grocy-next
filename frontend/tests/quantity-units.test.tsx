import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";

function mountUnits(path = "/quantityunits", { denied = false, savedSettings = {} } = {}) {
  const units = [
    {
      id: 1,
      name: "Box",
      name_plural: "Boxes",
      plural_forms: "",
      active: 1,
      description: "Cardboard packaging",
      userfields: { note: "Keep dry" },
    },
    {
      id: 2,
      name: "Bottle",
      name_plural: "Bottles",
      plural_forms: "",
      active: 1,
      description: "Glass container",
      userfields: { note: "Fragile" },
    },
    {
      id: 3,
      name: "Old unit",
      name_plural: "Old units",
      plural_forms: "",
      active: 0,
      description: "Legacy",
      userfields: {},
    },
  ];

  const app = mountNativeEditor(path, (url, options) => {
    if (url === "/api/objects/quantity_units") return Response.json(units);

    if (url === "/api/objects/userfields" || url === "/api/v2/custom-data/fields")
      return Response.json([{ ...notesField("quantity_units"), show_as_column_in_tables: 1 }]);

    if (url === "/api/user/settings") return Response.json(savedSettings);

    if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: !denied });

    if (options?.method === "DELETE" && url.startsWith("/api/objects/quantity_units/")) {
      if (denied) return Response.json({ error_message: "Permission denied" }, { status: 403 });
      const index = units.findIndex((row) => row.id === Number(url.split("/").at(-1)));

      if (index >= 0) units.splice(index, 1);

      return new Response(null, { status: 204 });
    }

    return undefined;
  });

  return { ...app, units };
}

test("quantity units renders native columns and literal userfields with saved searchable ordering", async () => {
  mountUnits();
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Bottle" });
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Bottle", "Box"]);
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/quantityunit/new");
  expect(screen.getByRole("link", { name: "Configure userfields" }).getAttribute("href")).toBe(
    "/userfields?entity=quantity_units",
  );
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Keep dry");
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Box"]);
  await user.clear(screen.getByRole("searchbox", { name: "Search" }));
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "all");
  expect(screen.getAllByRole("rowheader")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Name" }));
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Box", "Bottle"]);
});

test.each(["?include_disabled", "?include_disabled="])(
  "disabled units follow native presence versus checkbox query semantics %s",
  async (query) => {
    const app = mountUnits(`/quantityunits${query}`);
    const user = userEvent.setup();
    await screen.findByRole("rowheader", { name: "Old unit" });
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" });
    expect(checkbox.checked).toBe(query === "?include_disabled");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "Old");
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("rowheader", { name: "Old unit" })).toBeTruthy();
    expect(checkbox.checked).toBe(query === "?include_disabled");

    if (!checkbox.checked) await user.click(checkbox);
    await user.click(screen.getByRole("checkbox", { name: "Show disabled" }));
    await waitFor(() => expect(app.router.state.location.search.include_disabled).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Old unit" })).toBeNull());
  },
);

test("unit deletion confirms the selected identity then reloads the default list without disabled filters", async () => {
  const app = mountUnits("/quantityunits?include_disabled");
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Old unit" });
  await user.click(screen.getByRole("button", { name: "Delete this item: Old unit" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(
    within(dialog).getByText('Are you sure you want to delete quantity unit "Old unit"?'),
  ).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Old unit" })).toBeNull());
  expect(app.units.map((row) => row.id)).toEqual([1, 2]);
  await waitFor(() => expect(app.router.state.location.search).toEqual({}));
});

test.each(["?include.disabled", "?include+disabled", "?include_disabled[]"])(
  "PHP quantity-unit inclusion accepts %s while the browser checkbox remains off",
  async (query) => {
    mountUnits(`/quantityunits${query}`);
    await screen.findByRole("rowheader", { name: "Old unit" });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
      false,
    );
  },
);

test("an unclosed disabled-filter bracket does not register the PHP inclusion key", async () => {
  mountUnits("/quantityunits?include_disabled[");
  await screen.findByRole("rowheader", { name: "Box" });
  expect(screen.queryByRole("rowheader", { name: "Old unit" })).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
    false,
  );
});

test("native read view retains mutation links for denied writers and displays deletion failure", async () => {
  mountUnits("/quantityunits", { denied: true });
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Box" });
  expect(screen.getByRole("link", { name: "Add" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Edit this item: Box" }).getAttribute("href")).toBe(
    "/quantityunit/1",
  );
  await user.click(screen.getByRole("button", { name: "Delete this item: Box" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await screen.findByText("Permission denied");
  expect(screen.getByRole("rowheader", { name: "Box" })).toBeTruthy();
});

test("quantity-unit table restores its native saved column layout", async () => {
  mountUnits("/quantityunits", {
    savedSettings: {
      "datatables_state_quantityunits-table": JSON.stringify({
        time: 1,
        order: [[1, "desc"]],
        columns: [{ visible: true }, { visible: true }, { visible: false }, { visible: true }],
      }),
    },
  });
  await screen.findByRole("rowheader", { name: "Box" });
  expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Box", "Bottle"]);
  expect(screen.queryByRole("columnheader", { name: "Description" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Owner note" })).toBeTruthy();
});
