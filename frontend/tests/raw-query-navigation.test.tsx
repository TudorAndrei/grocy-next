import { act, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

function mountWire(search: string) {
  return mountNativeEditor(
    `/pantry/usersettings${search}`,
    (url) => {
      if (url === "/api/user/settings") return Response.json({ locale: "" });

      return undefined;
    },
    {},
    { basepath: "/pantry" },
  );
}

async function expectDestination(href: string) {
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe(href),
  );
}

test("native first-query semantics survive same-value navigation and history back without rewriting wire text", async () => {
  const common = "&returnto=%2Fsettings%3Ftab%3Dprofile&embedded&name=A%20B";
  const app = mountWire(`?returnto=%2Fusers${common}`);
  await expectDestination("/pantry/users");
  expect(app.router.history.location.search).toBe(`?returnto=%2Fusers${common}`);
  await act(async () =>
    app.router.navigate({ href: `/pantry/usersettings?returnto=%2Fequipment${common}` }),
  );
  await expectDestination("/pantry/equipment");
  expect(app.router.history.location.search).toBe(`?returnto=%2Fequipment${common}`);
  await act(async () => app.router.history.back());
  await expectDestination("/pantry/users");
  expect(app.router.history.location.search).toBe(`?returnto=%2Fusers${common}`);
});

test("structured search changes rewrite changed keys while inherited native duplicates and bare flags remain intact", async () => {
  const app = mountWire("?returnto=%2Fusers&returnto=%2Fequipment&embedded&name=A%20B");
  await expectDestination("/pantry/users");
  await act(async () =>
    app.router.navigate({
      to: "/usersettings",
      search: (previous) => ({ ...previous, name: "C D", filter: "x/y" }),
    }),
  );
  await expectDestination("/pantry/users");
  expect(app.router.history.location.search).toBe(
    "?returnto=%2Fusers&returnto=%2Fequipment&embedded&name=C+D&filter=x%2Fy",
  );
  await act(async () =>
    app.router.navigate({
      to: "/usersettings",
      search: { returnto: "/users", embedded: "", name: "C D" },
    }),
  );
  await expectDestination("/pantry/users");
  expect(app.router.history.location.search).toBe("?returnto=%2Fusers&embedded=&name=C+D");
});
