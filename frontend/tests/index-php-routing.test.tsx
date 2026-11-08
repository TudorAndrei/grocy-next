import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

test.each([
  { basepath: "/pantry/index.php/", visible: "/pantry/index.php", output: "/pantry/index.php" },
  { basepath: "/index.php/", visible: "/index.php", output: "/index.php" },
  { basepath: "/pantry/", visible: "/pantry/index.php", output: "/pantry" },
  { basepath: "/", visible: "/index.php", output: "" },
])(
  "native settings retain script URL wire text and navigate using configured $basepath",
  async ({ basepath, visible, output }) => {
    const search = "?returnto=%2Fbarcodescannertesting&returnto=%2Fusers&embedded&label=A%20B";
    const path = visible + "/usersettings" + search + "#details";
    const app = mountNativeEditor(path, () => undefined, {}, { basepath });
    await screen.findByRole("heading", { name: "User settings" });
    const ok = await screen.findByRole("link", { name: "OK" });
    expect(ok.getAttribute("href")).toBe(output + "/barcodescannertesting");
    expect(app.router.history.location.href).toBe(path);
    expect(app.router.state.location.pathname).toBe("/usersettings");
    expect(app.router.state.location.searchStr).toBe(search);
    await waitFor(() => {
      const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      const data = new URL(manifest!.href).searchParams.get("data")!;

      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(data), (character) => character.charCodeAt(0)),
      );

      expect(decoded).toBe(`User settings#${window.location.origin}${path}`);
    });
    await act(() =>
      app.router.navigate({
        to: "/usersettings",
        search: (previous) => ({ ...previous, extra: "C D" }),
        hash: "details",
        replace: true,
      }),
    );
    const changed = visible + "/usersettings" + search + "&extra=C+D#details";
    expect(app.router.history.location.href).toBe(changed);
    await userEvent.click(await screen.findByRole("link", { name: "OK" }));
    await screen.findByRole("heading", { name: "Barcode scanner testing" });
    expect(app.router.history.location.pathname).toBe(output + "/barcodescannertesting");
    await act(() => app.router.history.back());
    await screen.findByRole("heading", { name: "User settings" });
    expect(app.router.history.location.href).toBe(changed);
    expect((await screen.findByRole("link", { name: "OK" })).getAttribute("href")).toBe(
      output + "/barcodescannertesting",
    );
  },
);

test.each(["/pantry/index.php/", "/pantry/"])(
  "canonical script login matches with frontend base %s without rewriting its form action",
  async (basepath) => {
    const path = "/pantry/index.php/login?invalid=true&invalid=false&embedded";

    const app = mountNativeEditor(
      path,
      (url) =>
        url === "/api/v2/system/login-context"
          ? Response.json({
              login_url: "/pantry/index.php/login",
              logout_url: "/pantry/index.php/logout",
            })
          : undefined,
      {},
      { basepath },
    );

    const username = await screen.findByRole("textbox", { name: "Username" });
    const form = username.closest("form")!;
    expect(form.method).toBe("post");
    expect(new URL(form.action).pathname).toBe("/pantry/index.php/login");
    expect(screen.getByText("Invalid credentials, please try again")).toBeTruthy();
    expect(app.router.history.location.href).toBe(path);
    expect(app.router.state.location.pathname).toBe("/login");
  },
);

test("index.php object names are retained outside the leading application boundary", async () => {
  const app = mountNativeEditor(
    "/pantry/userobjects/index.php",
    (url) =>
      url === "/api/v2/custom-data/userobjects/index.php"
        ? Response.json({
            userentity: {
              id: 9,
              name: "index.php",
              caption: "Index records",
              description: null,
              show_in_sidebar_menu: 0,
              icon_css_class: null,
            },
            fields: [],
            rows: [],
          })
        : undefined,
    {},
    { basepath: "/pantry/" },
  );

  await screen.findByRole("heading", { name: "Index records" });
  expect(app.router.state.location.pathname).toBe("/userobjects/index.php");
  expect(app.router.history.location.pathname).toBe("/pantry/userobjects/index.php");
});

test.each([
  { basepath: "/pantry/", path: "/pantry/index.php-other/usersettings" },
  { basepath: "/pantry/index.php/", path: "/pantry/index.php/index.php/usersettings" },
])("only one exact application script segment matches: $path", async ({ basepath, path }) => {
  const app = mountNativeEditor(path, () => undefined, {}, { basepath });
  await screen.findByText("Not Found");
  expect(screen.queryByRole("heading", { name: "User settings" })).toBeNull();
  expect(app.router.history.location.pathname).toBe(path);
});
