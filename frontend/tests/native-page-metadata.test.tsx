import { act, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";

test("authenticated page manifests retain Unicode titles and the current raw URL, then retire on login", async () => {
  const path = "/barcodescannertesting?barcode=%C3%A9&bare&x=first%20value&x=last";

  const app = mountNativeEditor(path, (url) => {
    if (url.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "de",
        direction: "ltr",
        languages: ["en", "de"],
        catalog: {
          domain: "grocy/strings",
          "plural-forms": "nplurals=2; plural=(n != 1);",
          messages: { "": { "Barcode scanner testing": ["Scannerprüfung"] } },
        },
      });
  });

  await screen.findByRole("heading", { name: "Scannerprüfung" });

  await waitFor(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    expect(link?.crossOrigin).toBe("use-credentials");
    const data = new URL(link!.href).searchParams.get("data")!;

    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(data), (value) => value.charCodeAt(0)),
    );

    expect(decoded).toBe(`Scannerprüfung#${window.location.origin}${path}`);
    expect(document.title).toBe("Scannerprüfung | Grocy");
  });

  await act(async () => app.router.navigate({ to: "/usersettings" }));
  await screen.findByRole("heading", { name: "User settings" });
  await waitFor(() => expect(document.title).toBe("User settings | Grocy"));
  expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);

  await act(async () => app.router.navigate({ to: "/login" }));
  await waitFor(() => expect(document.querySelector('link[rel="manifest"]')).toBeNull());
});
