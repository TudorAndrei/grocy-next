import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import {
  cookieSessionSelected,
  configStorageKeys,
  selectCookieSession,
  writeApiConfig,
} from "@/lib/config";
import type { EquipmentRecord } from "@/lib/equipment-page";
import type { JsonObject } from "@/lib/json";

const warranty = btoa("warranty.pdf") + "_" + btoa("Warranty.pdf");
const receipt = btoa("receipt.pdf") + "_" + btoa("Receipt.pdf");
const laterReceipt = btoa("later.pdf") + "_" + btoa("Later.pdf") + "_raw-extra";
const filteredDefinitions = "/api/objects/userfields?query[]=entity=equipment&query[]=type=file";

type EquipmentFixtureOptions = {
  heldDetails?: boolean;
  heldConfig?: boolean;
  missingFirstDetail?: boolean;
  heldDefinitions?: boolean;
  definitionRecord?: boolean;
  numericFiles?: boolean;
  heldDelete?: boolean;
  deniedDelete?: boolean;
  layout?: string;
  path?: string;
  cookieSession?: boolean;
  browserSession?: boolean;
  config?: JsonObject;
  receiptValue?: string;
  manualName?: string;
  expectedApiKey?: string | null;
};

function mount({
  heldDetails = false,
  heldConfig = false,
  missingFirstDetail = false,
  heldDefinitions = false,
  definitionRecord = false,
  numericFiles = false,
  heldDelete = false,
  deniedDelete = false,
  layout = "",
  path = "/equipment",
  cookieSession = false,
  browserSession = false,
  config = {},
  receiptValue = receipt,
  manualName = "alpha.pdf",
  expectedApiKey,
}: EquipmentFixtureOptions = {}) {
  if (cookieSession) selectCookieSession();

  const rows: EquipmentRecord[] = [
    {
      id: 2,
      name: "Zulu drill",
      description: "<p>Drill notes</p>",
      instruction_manual_file_name: null,
      userfields: null,
    },
    {
      id: 1,
      name: "Alpha mixer",
      description: "<p>Alpha <strong>notes</strong></p>",
      instruction_manual_file_name: manualName,
      userfields: { note: "Kitchen", warranty, receipt: receiptValue, private: "Do not search" },
    },
    {
      id: 3,
      name: "Beta radio",
      description: "<p>Radio notes</p>",
      instruction_manual_file_name: null,
      userfields: { note: "Office", warranty: null, receipt: null },
    },
  ];

  if (definitionRecord)
    rows.push({
      id: 4,
      name: "Delta saw",
      description: "<p>Saw notes</p>",
      instruction_manual_file_name: "saw.pdf",
      userfields: { warranty: laterReceipt, receipt: laterReceipt, "0": laterReceipt },
    });

  if (numericFiles)
    rows.push({
      id: 5,
      name: "Numeric radio",
      description: "<p>Numeric notes</p>",
      instruction_manual_file_name: "numeric.pdf",
      userfields: { "0": laterReceipt },
    });

  const fields = [
    { ...notesField("equipment"), sort_number: null, show_as_column_in_tables: 1 },
    {
      ...notesField("equipment"),
      id: 2,
      name: "warranty",
      caption: "Warranty",
      type: "file",
      sort_number: 1,
      show_as_column_in_tables: 1,
    },
    {
      ...notesField("equipment"),
      id: 3,
      name: "receipt",
      caption: "Receipt",
      type: "file",
      sort_number: 2,
      show_as_column_in_tables: 0,
    },
    {
      ...notesField("equipment"),
      id: 4,
      name: "private",
      caption: "Private",
      sort_number: 3,
      show_as_column_in_tables: 0,
    },
  ];

  if (numericFiles)
    fields.push({
      ...notesField("equipment"),
      id: 5,
      name: "0",
      caption: "Numeric document",
      type: "file",
      sort_number: 4,
      show_as_column_in_tables: 0,
    });

  const definitionReads: Array<{
    path: string;
    signal?: AbortSignal | null;
    release: (response: Response) => void;
  }> = [];

  const detailReplies: Array<{ id: number; resolve: () => void }> = [];
  const detailReads: number[] = [];
  const documentReads: string[] = [];
  const writes: string[] = [];
  const previews: Blob[] = [];
  const revoked: string[] = [];
  let listReads = 0;
  let configReads = 0;
  let releaseConfig = () => {};
  let releaseDelete = () => {};

  const configuration = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });

  const deletion = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        previews.push(blob);

        return `blob:equipment-${previews.length}`;
      }
      static revokeObjectURL(url: string) {
        revoked.push(url);
      }
    },
  );
  vi.spyOn(window, "open").mockImplementation(() => null);

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      const method = init?.method ?? "GET";

      if (cookieSession) expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBeNull();
      else if (expectedApiKey !== undefined) {
        const key = new Headers(init?.headers).get("GROCY-API-KEY");

        // Key-only servers reject the initial bare identity probe before accepting the fallback.
        if (
          (url === "/api/user" && (key !== null || browserSession)) ||
          url.startsWith("/api/objects/equipment")
        )
          expect(key).toBe(expectedApiKey);
      }

      if (url === "/api/system/config") {
        configReads++;

        if (heldConfig) await configuration;

        return undefined;
      }

      if (url === "/api/system/info") return Response.json({ grocy_version: { Version: "test" } });

      if (url === "/api/user/settings")
        return Response.json(layout ? { "datatables_state_equipment-table": layout } : {});

      if (url.startsWith("/api/user/settings/")) return new Response(null, { status: 204 });

      if (url === filteredDefinitions) {
        if (heldDefinitions)
          return new Promise<Response>((release) => {
            definitionReads.push({ path: url, signal: init?.signal, release });
          });
        definitionReads.push({ path: url, signal: init?.signal, release: () => {} });

        return Response.json(fields.filter((field) => field.type === "file"));
      }

      if (url === "/api/v2/custom-data/fields" || url === "/api/objects/userfields")
        return Response.json(fields);

      if (url === "/api/objects/equipment") {
        listReads++;
        const response = Response.json(rows);

        if (missingFirstDetail && listReads === 1)
          rows.splice(
            rows.findIndex((row) => row.id === 1),
            1,
          );

        return response;
      }

      const selected = /^\/api\/objects\/equipment\/(\d+)$/.exec(url);

      if (selected) {
        const id = Number(selected[1]);

        if (method === "DELETE") {
          writes.push(url);

          if (heldDelete) await deletion;

          if (deniedDelete)
            return Response.json(
              { error_message: "Permission missing: EQUIPMENT" },
              { status: 403 },
            );
          const index = rows.findIndex((row) => row.id === id);

          if (index < 0)
            return Response.json({ error_message: "Object not found" }, { status: 400 });
          rows.splice(index, 1);

          return new Response(null, { status: 204 });
        }

        detailReads.push(id);
        const row = rows.find((row) => row.id === id);

        const response = row
          ? Response.json(numericFiles && id === 5 ? { ...row, userfields: [laterReceipt] } : row)
          : Response.json({ error_message: "Object not found" }, { status: 404 });

        if (heldDetails) await new Promise<void>((resolve) => detailReplies.push({ id, resolve }));

        return response;
      }

      const custom = /^\/api\/userfields\/equipment\/(\d+)$/.exec(url);

      if (custom)
        return Response.json(rows.find((row) => row.id === Number(custom[1]))?.userfields ?? {});
      const content = /^\/api\/v2\/content\/equipment\/(\d+)$/.exec(url);

      if (content)
        return Response.json({
          html: rows.find((row) => row.id === Number(content[1]))?.description ?? "",
        });

      if (url === "/api/v2/content/equipment")
        return Response.json(rows.map((row) => ({ id: row.id, html: row.description })));

      if (url.startsWith("/api/files/equipmentmanuals/") || url.startsWith("/files/userfiles/")) {
        expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe(
          cookieSession ? null : expectedApiKey === undefined ? "dev-key" : expectedApiKey,
        );
        documentReads.push(url);

        return new Response("%PDF-fixture", { headers: { "Content-Type": "text/html" } });
      }

      return undefined;
    },
    { FEATURE_FLAG_EQUIPMENT: true, ...config },
    {},
    { browserSession },
  );

  return {
    ...app,
    rows,
    detailReads,
    detailReplies,
    definitionReads,
    documentReads,
    writes,
    previews,
    revoked,
    releaseDelete,
    releaseConfig,
    configReads: () => configReads,
    listReads: () => listReads,
  };
}

const equipmentRow = (name: string) => screen.getByRole("button", { name }).closest("tr")!;

test("native equipment table exposes its Name column and selects its first record", async () => {
  const app = mount();
  await screen.findByRole("columnheader", { name: "Name" });
  expect(screen.getByRole("columnheader", { name: "Owner note" })).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Warranty" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Receipt" })).toBeNull();
  expect(screen.queryByText("Private")).toBeNull();
  await waitFor(() => expect(app.detailReads).toEqual([1]));

  const manual = await screen.findByLabelText<HTMLObjectElement>("Instruction manual", {
    selector: "object",
  });

  expect(equipmentRow("Alpha mixer").getAttribute("aria-selected")).toBe("true");
  expect(
    screen.getByRole("tab", { name: "Instruction manual" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/equipment/new");
  expect(screen.getByRole("link", { name: "Edit Zulu drill" }).getAttribute("href")).toBe(
    "/equipment/2",
  );
  await userEvent.setup().click(screen.getByRole("tab", { name: "Notes" }));
  const notes = within(screen.getByRole("tabpanel", { name: "Notes" }));
  expect((await notes.findByText("notes")).tagName).toBe("STRONG");
  expect(app.previews.every((blob) => blob.type === "application/pdf")).toBe(true);
  expect(app.definitionReads).toEqual([]);
  const source = manual.data;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  app.rows.splice(
    app.rows.findIndex((row) => row.id === 3),
    1,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Beta radio" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Object not found");
  expect(equipmentRow("Beta radio").getAttribute("aria-selected")).toBe("true");
  expect(
    within(screen.getByRole("tabpanel", { name: "Notes" })).getByRole("heading", {
      name: "Alpha mixer",
    }),
  ).toBeTruthy();
  expect(screen.getByLabelText("Instruction manual", { selector: "object" })).toBe(manual);
  expect(manual.data).toBe(source);
  expect(logger).not.toHaveBeenCalled();
  expect(app.definitionReads).toEqual([]);
});

test("all file tabs use authenticated native URLs and retain the null-userfields source defect", async () => {
  const app = mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Alpha mixer" });
  await user.click(screen.getByRole("tab", { name: "Receipt" }));

  const preview = await within(
    screen.getByRole("tabpanel", { name: "Receipt" }),
  ).findByLabelText<HTMLObjectElement>("Receipt", { selector: "object" });

  const original = preview.data;
  expect(app.documentReads).toContain(`/files/userfiles/${receipt}`);
  await user.click(screen.getByRole("button", { name: "Zulu drill" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true"),
  );
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(
    within(screen.getByRole("tabpanel", { name: "Receipt" })).getByLabelText<HTMLObjectElement>(
      "Receipt",
      { selector: "object" },
    ).data,
  ).toBe(original);
  await user.click(screen.getByRole("button", { name: "Beta radio" }));
  await waitFor(() => expect(app.revoked).toContain(original));
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(
    within(screen.getByRole("tabpanel", { name: "Receipt" })).queryByLabelText("Receipt", {
      selector: "object",
    }),
  ).toBeNull();
  await user.click(screen.getByRole("tab", { name: "Instruction manual" }));
  expect(screen.getByText("The selected equipment has no instruction manual")).toBeTruthy();
});

type EquipmentTransportCase = {
  label: string;
  value: string | number | boolean | undefined;
  explicit: boolean;
  native: boolean;
  mode?: string;
  envKey?: string;
  envBase?: string;
  browserSession?: boolean;
};

const equipmentTransportCases: EquipmentTransportCase[] = [
  { label: "absent", value: undefined, explicit: false, native: false },
  { label: "false", value: false, explicit: false, native: false },
  { label: "zero", value: 0, explicit: false, native: false },
  { label: "string zero", value: "0", explicit: false, native: false },
  { label: "empty string", value: "", explicit: false, native: false },
  {
    label: "nonempty string false",
    browserSession: true,
    value: "false",
    explicit: false,
    native: true,
  },
  {
    label: "true with fresh storage",
    browserSession: true,
    value: true,
    explicit: false,
    native: true,
  },
  {
    label: "true with explicit default-key Connection",
    browserSession: true,
    value: true,
    explicit: true,
    native: false,
  },
  {
    label: "dev bypass",
    browserSession: true,
    value: false,
    mode: "dev",
    explicit: false,
    native: true,
  },
  {
    label: "demo bypass",
    browserSession: true,
    value: false,
    mode: "demo",
    explicit: false,
    native: true,
  },
  {
    label: "prerelease bypass",
    browserSession: true,
    value: false,
    mode: "prerelease",
    explicit: false,
    native: true,
  },
  {
    label: "true with explicit build key",
    browserSession: true,
    value: true,
    envKey: "equipment-build-key",
    explicit: false,
    native: false,
  },
  {
    label: "true with explicit same-origin build base",
    browserSession: true,
    value: true,
    envBase: "/",
    explicit: false,
    native: false,
  },
];

test.each(equipmentTransportCases)(
  "Equipment $label preserves the document resource transport",
  async ({
    value,
    explicit,
    native,
    mode = "production",
    envKey,
    envBase,
    browserSession = false,
  }) => {
    vi.stubEnv("VITE_API_KEY", envKey);
    vi.stubEnv("VITE_API_BASE", envBase);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    expect(localStorage.length).toBe(0);

    if (explicit) writeApiConfig({ baseUrl: "/", apiKey: "dev-key" });
    const packed = `${receipt}_auth-extra-token`;
    const base = `${window.location.origin}/house.hold/`;

    const serverConfig: JsonObject = {
      MODE: mode,
      AUTH_CLASS: "Grocy\\Middleware\\DefaultAuthMiddleware",
      BASE_URL: base,
      DISABLE_URL_REWRITING: true,
    };

    if (value !== undefined) serverConfig.DISABLE_AUTH = value;

    const app = mount({
      receiptValue: packed,
      manualName: "aa>.pdf",
      config: serverConfig,
      expectedApiKey: native ? null : envKey || "dev-key",
      browserSession,
    });

    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Alpha mixer" });
    await user.click(screen.getByRole("tab", { name: "Receipt" }));
    const receiptPanel = screen.getByRole("tabpanel", { name: "Receipt" });

    if (native) {
      const preview = await within(receiptPanel).findByLabelText<HTMLEmbedElement>("Receipt", {
        selector: "embed",
      });

      await waitFor(() =>
        expect(preview.getAttribute("src")).toBe(`${base}index.php/files/userfiles/${packed}`),
      );

      const manual = screen.getByLabelText<HTMLEmbedElement>("Instruction manual", {
        selector: "embed",
      });

      expect(manual.getAttribute("src")).toBe(
        `${base}index.php/api/files/equipmentmanuals/YWE+LnBkZg==`,
      );
      expect(manual.type).toBe("application/pdf");
      const link = within(receiptPanel).getByRole("link", { name: "Download file" });
      expect(link.getAttribute("href")).toBe(preview.getAttribute("src"));
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")?.split(/\s+/)).toContain("noopener");
      expect(app.definitionReads).toHaveLength(1);
      expect(app.definitionReads[0]!.path).toBe(filteredDefinitions);
      expect(app.documentReads).toEqual([]);
      expect(app.previews).toEqual([]);
    } else {
      await within(receiptPanel).findByLabelText("Receipt", { selector: "object" });
      expect(within(receiptPanel).getByRole("button", { name: "Download file" })).toBeTruthy();
      expect(within(receiptPanel).queryByRole("link", { name: "Download file" })).toBeNull();
      expect(document.querySelector("embed")).toBeNull();
      expect(app.documentReads).toContain(`/files/userfiles/${packed}`);
      expect(app.previews.length).toBeGreaterThan(0);
      expect(app.definitionReads).toEqual([]);
    }

    expect(cookieSessionSelected()).toBe(false);
    const keys = configStorageKeys();
    expect(localStorage.getItem(keys.base)).toBe(explicit ? "/" : null);
    expect(localStorage.getItem(keys.key)).toBe(explicit ? "dev-key" : null);
    expect(localStorage.length).toBe(explicit ? 2 : 0);
    expect(
      app.fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes("/login") && init?.method === "POST",
      ),
    ).toBe(false);
  },
);

test("fresh auth-disabled bootstrap waits for held config and initializes its first native callbacks", async () => {
  expect(localStorage.length).toBe(0);

  const app = mount({
    heldConfig: true,
    browserSession: true,
    config: { MODE: "production", DISABLE_AUTH: true },
  });

  await waitFor(() => expect(app.configReads()).toBe(1));
  // The pending global config may withhold the host itself; neither extra resource path may start.
  expect(app.documentReads).toEqual([]);
  expect(app.previews).toEqual([]);
  expect(localStorage.length).toBe(0);
  await act(async () => app.releaseConfig());

  const manual = await screen.findByLabelText<HTMLEmbedElement>("Instruction manual", {
    selector: "embed",
  });

  await waitFor(() =>
    expect(manual.getAttribute("src")).toBe("/api/files/equipmentmanuals/YWxwaGEucGRm"),
  );
  await userEvent.setup().click(screen.getByRole("tab", { name: "Receipt" }));
  const preview = screen.getByLabelText<HTMLEmbedElement>("Receipt", { selector: "embed" });
  await waitFor(() => expect(preview.getAttribute("src")).toBe(`/files/userfiles/${receipt}`));
  expect(app.definitionReads).toHaveLength(1);
  expect(app.detailReads).toEqual([1]);
  expect(app.documentReads).toEqual([]);
  expect(app.previews).toEqual([]);
  expect(cookieSessionSelected()).toBe(false);
  expect(localStorage.length).toBe(0);
});

test("cookie equipment resources retain direct PDF nodes and raw configured URLs across selections", async () => {
  const packed = `${receipt}_ignored-extra-token`;

  const app = mount({
    cookieSession: true,
    heldDetails: true,
    heldDefinitions: true,
    definitionRecord: true,
    receiptValue: packed,
    manualName: "aa>.pdf",
    config: { BASE_URL: "https://grocy.invalid/house.hold/", DISABLE_URL_REWRITING: true },
  });

  const user = userEvent.setup();
  await waitFor(() => expect(app.detailReads).toEqual([1]));
  const manualPanel = document.getElementById("equipment-manual-panel")!;
  const receiptPanel = document.getElementById("equipment-file-3-panel")!;
  const manual = manualPanel.querySelector("embed")!;
  const custom = receiptPanel.querySelector("embed")!;
  const manualLink = manualPanel.querySelector<HTMLAnchorElement>('a[title="Download file"]')!;
  const customLink = receiptPanel.querySelector<HTMLAnchorElement>('a[title="Download file"]')!;
  expect(manual).not.toBeNull();
  expect(custom).not.toBeNull();
  expect(manual.getAttribute("src")).toBe("");
  expect(custom.getAttribute("src")).toBe("");
  expect(manualLink.getAttribute("href")).toBe("#");
  expect(customLink.getAttribute("href")).toBe("#");
  await act(async () => app.detailReplies[0]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(1));
  expect(custom.getAttribute("src")).toBe("");
  await act(async () =>
    app.definitionReads[0]!.release(Response.json([{ name: "receipt" }, { name: "warranty" }])),
  );

  const manualUrl =
    "https://grocy.invalid/house.hold/index.php/api/files/equipmentmanuals/YWE+LnBkZg==";

  const customUrl = `https://grocy.invalid/house.hold/index.php/files/userfiles/${packed}`;
  await waitFor(() => expect(manual.getAttribute("src")).toBe(manualUrl));
  expect(manualPanel.querySelector("embed")).toBe(manual);
  expect(manual.type).toBe("application/pdf");
  expect(manualLink.getAttribute("href")).toBe(manualUrl);
  expect(manualLink.target).toBe("_blank");
  expect(manualLink.rel.split(/\s+/)).toContain("noopener");
  const expand = within(manualPanel).getByRole("button", { name: "Expand to fullscreen" });
  await user.click(expand);
  await screen.findByRole("dialog", { name: "Instruction manual" });
  await user.tab();
  expect(document.activeElement).toBe(expand);
  await user.tab();
  expect(document.activeElement).toBe(manualLink);
  await user.tab();
  expect(document.activeElement).toBe(manual);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(manualLink);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Instruction manual" })).toBeNull();
  expect(document.activeElement).toBe(expand);
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(custom.getAttribute("src")).toBe(customUrl);
  expect(custom.type).toBe("application/pdf");
  expect(custom.closest("[hidden]")).toBeNull();
  expect(customLink.getAttribute("href")).toBe(customUrl);
  expect(customLink.target).toBe("_blank");
  expect(customLink.rel.split(/\s+/)).toContain("noopener");
  await user.click(screen.getByRole("button", { name: "Zulu drill" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2]));
  await act(async () => app.detailReplies[1]!.resolve());
  expect(app.definitionReads).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "Instruction manual" }));
  expect(manual.closest("[hidden]")).not.toBeNull();
  expect(manual.getAttribute("src")).toBe(manualUrl);
  expect(manualLink.getAttribute("href")).toBe(manualUrl);
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(custom.closest("[hidden]")).toBeNull();
  expect(custom.getAttribute("src")).toBe(customUrl);
  await user.click(screen.getByRole("button", { name: "Beta radio" }));
  await waitFor(() => expect(app.detailReads).toEqual([1, 2, 3]));
  await act(async () => app.detailReplies[2]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(2));
  expect(custom.getAttribute("src")).toBe(customUrl);
  await act(async () =>
    app.definitionReads[1]!.release(Response.json([{ name: "receipt" }, { name: "warranty" }])),
  );
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(receiptPanel.querySelector("embed")).toBe(custom);
  expect(custom.closest("[hidden]")).not.toBeNull();
  expect(custom.getAttribute("src")).toBe(customUrl);
  expect(customLink.getAttribute("href")).toBe(customUrl);
  const sourceChanges: MutationRecord[] = [];
  const observer = new MutationObserver((changes) => sourceChanges.push(...changes));
  observer.observe(manual, { attributes: true, attributeFilter: ["src"] });
  observer.observe(custom, { attributes: true, attributeFilter: ["src"] });

  try {
    await user.click(screen.getByRole("button", { name: "Alpha mixer" }));
    await waitFor(() => expect(app.detailReads).toEqual([1, 2, 3, 1]));
    expect(sourceChanges).toEqual([]);
    await act(async () => app.detailReplies[3]!.resolve());
    await waitFor(() => expect(app.definitionReads).toHaveLength(3));
    expect(sourceChanges.map((change) => change.target)).toContain(manual);
    expect(sourceChanges.map((change) => change.target)).not.toContain(custom);
    await act(async () =>
      app.definitionReads[2]!.release(Response.json([{ name: "receipt" }, { name: "warranty" }])),
    );
    expect(manualPanel.querySelector("embed")).toBe(manual);
    expect(receiptPanel.querySelector("embed")).toBe(custom);
    expect(manual.getAttribute("src")).toBe(manualUrl);
    expect(custom.getAttribute("src")).toBe(customUrl);
    await waitFor(() => {
      expect(sourceChanges.map((change) => change.target)).toContain(manual);
      expect(sourceChanges.map((change) => change.target)).toContain(custom);
    });
    await user.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(custom.closest("[hidden]")).toBeNull();
  } finally {
    observer.disconnect();
  }

  // A's definitions are independent of a later accepted detail response B.
  await user.click(screen.getByRole("button", { name: "Alpha mixer" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(5));
  await act(async () => app.detailReplies[4]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(4));
  await user.click(screen.getByRole("button", { name: "Delta saw" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(6));
  await act(async () => app.detailReplies[5]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(5));
  expect(app.definitionReads[3]!.signal?.aborted).toBe(false);
  await act(async () => app.definitionReads[4]!.release(Response.json([{ name: "receipt" }])));

  const deltaManualUrl =
    "https://grocy.invalid/house.hold/index.php/api/files/equipmentmanuals/c2F3LnBkZg==";

  const deltaCustomUrl = `https://grocy.invalid/house.hold/index.php/files/userfiles/${laterReceipt}`;
  expect(manual.getAttribute("src")).toBe(deltaManualUrl);
  expect(custom.getAttribute("src")).toBe(deltaCustomUrl);
  expect(within(manualPanel).getByRole("heading", { name: "Delta saw" })).toBeTruthy();
  expect(
    screen.getByRole("tab", { name: "Instruction manual" }).getAttribute("aria-selected"),
  ).toBe("true");
  await act(async () => app.definitionReads[3]!.release(Response.json([{ name: "receipt" }])));
  expect(receiptPanel.querySelector("embed")).toBe(custom);
  expect(custom.getAttribute("src")).toBe(customUrl);
  expect(manual.getAttribute("src")).toBe(deltaManualUrl);
  expect(within(manualPanel).getByRole("heading", { name: "Delta saw" })).toBeTruthy();
  expect(equipmentRow("Delta saw").getAttribute("aria-selected")).toBe("true");
  expect(
    screen.getByRole("tab", { name: "Instruction manual" }).getAttribute("aria-selected"),
  ).toBe("true");
  // A table snapshot can outlive B on the server; its failed primary read must retain A's accepted view.
  await user.click(screen.getByRole("button", { name: "Alpha mixer" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(7));
  await act(async () => app.detailReplies[6]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(6));
  await act(async () => app.definitionReads[5]!.release(Response.json([{ name: "receipt" }])));
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  app.rows.splice(
    app.rows.findIndex((row) => row.id === 3),
    1,
  );
  await user.click(screen.getByRole("button", { name: "Beta radio" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(8));
  await act(async () => app.detailReplies[7]!.resolve());
  expect(equipmentRow("Beta radio").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Receipt" }).getAttribute("aria-selected")).toBe("true");
  expect(within(receiptPanel).getByRole("heading", { name: "Alpha mixer" })).toBeTruthy();
  expect(manualPanel.querySelector("embed")).toBe(manual);
  expect(receiptPanel.querySelector("embed")).toBe(custom);
  expect(manual.getAttribute("src")).toBe(manualUrl);
  expect(custom.getAttribute("src")).toBe(customUrl);
  expect(custom.closest("[hidden]")).toBeNull();
  expect(app.definitionReads).toHaveLength(6);
  await waitFor(() => expect(logger).toHaveBeenCalledOnce());
  expect(logger.mock.calls[0]?.[0]).toMatchObject({ status: 404, message: "Object not found" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Delta saw" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(9));
  await act(async () => app.detailReplies[8]!.resolve());
  await waitFor(() => expect(app.definitionReads).toHaveLength(7));
  await act(async () => app.definitionReads[6]!.release(Response.json([{ name: "receipt" }])));
  expect(within(manualPanel).getByRole("heading", { name: "Delta saw" })).toBeTruthy();
  expect(manual.getAttribute("src")).toBe(deltaManualUrl);
  expect(custom.getAttribute("src")).toBe(deltaCustomUrl);
  expect(logger).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.definitionReads.every((read) => read.path === filteredDefinitions)).toBe(true);
  expect(app.documentReads).toEqual([]);
  expect(app.previews).toEqual([]);
  expect(app.revoked).toEqual([]);
  expect(window.open).not.toHaveBeenCalled();
});

test("cookie initial missing-detail failure leaves the blank resource card usable without a loading state", async () => {
  const app = mount({ cookieSession: true, heldDetails: true, missingFirstDetail: true });
  const user = userEvent.setup();
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  await waitFor(() => expect(app.detailReplies).toHaveLength(1));
  const selected = screen.getByLabelText("Selected equipment");
  const manualPanel = document.getElementById("equipment-manual-panel")!;
  const manual = manualPanel.querySelector("embed")!;
  const link = manualPanel.querySelector<HTMLAnchorElement>('a[title="Download file"]')!;
  expect(manual.getAttribute("src")).toBe("");
  expect(link.getAttribute("href")).toBe("#");
  await act(async () => app.detailReplies[0]!.resolve());
  expect(manualPanel.querySelector("embed")).toBe(manual);
  expect(manual.getAttribute("src")).toBe("");
  expect(manual.closest("[hidden]")).toBeNull();
  expect(link.getAttribute("href")).toBe("#");
  expect(within(selected).queryByRole("heading", { name: "Alpha mixer" })).toBeNull();
  expect(equipmentRow("Alpha mixer").getAttribute("aria-selected")).toBe("true");
  expect(app.definitionReads).toEqual([]);
  await waitFor(() => expect(logger).toHaveBeenCalledOnce());
  expect(logger.mock.calls[0]?.[0]).toMatchObject({ status: 404, message: "Object not found" });
  expect(within(selected).queryByText("Loading…")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Beta radio" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(2));
  await act(async () => app.detailReplies[1]!.resolve());
  await within(screen.getByRole("tabpanel", { name: "Notes" })).findByText("Radio notes");
  expect(equipmentRow("Beta radio").getAttribute("aria-selected")).toBe("true");
  expect(logger).toHaveBeenCalledOnce();
});

test("cookie file-definition callbacks preserve prior tabs on failure and sparse replies and read numeric wire names", async () => {
  const app = mount({
    cookieSession: true,
    heldDefinitions: true,
    definitionRecord: true,
    numericFiles: true,
  });

  const user = userEvent.setup();
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  await waitFor(() => expect(app.definitionReads).toHaveLength(1));
  await act(async () =>
    app.definitionReads[0]!.release(Response.json([{ name: "receipt" }, { name: "warranty" }])),
  );
  const custom = document.getElementById("equipment-file-3-panel")!.querySelector("embed")!;

  const warrantyPreview = document
    .getElementById("equipment-file-2-panel")!
    .querySelector("embed")!;

  const numeric = document.getElementById("equipment-file-5-panel")!.querySelector("embed")!;
  const manualPanel = document.getElementById("equipment-manual-panel")!;
  const manual = manualPanel.querySelector("embed")!;
  const originalReceipt = custom.getAttribute("src");
  const originalWarranty = warrantyPreview.getAttribute("src");
  const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
  await user.click(screen.getByRole("button", { name: "Delta saw" }));
  await waitFor(() => expect(app.definitionReads).toHaveLength(2));
  expect(custom.getAttribute("src")).toBe(originalReceipt);
  await act(async () =>
    app.definitionReads[1]!.release(
      Response.json({ error_message: "Private definitions failure" }, { status: 503 }),
    ),
  );
  await waitFor(() => expect(logger).toHaveBeenCalledOnce());
  expect(custom.getAttribute("src")).toBe(originalReceipt);
  expect(warrantyPreview.getAttribute("src")).toBe(originalWarranty);
  expect(manual.getAttribute("src")).toBe("/api/files/equipmentmanuals/c2F3LnBkZg==");
  expect(within(manualPanel).getByRole("heading", { name: "Delta saw" })).toBeTruthy();
  expect(screen.queryByText("Private definitions failure")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

  for (const [index, response] of [
    [2, []],
    [3, [{ name: "unknown-file" }]],
  ] as const) {
    await user.click(screen.getByRole("button", { name: "Delta saw" }));
    await waitFor(() => expect(app.definitionReads).toHaveLength(index + 1));
    await act(async () => app.definitionReads[index]!.release(Response.json(response)));
    expect(custom.getAttribute("src")).toBe(originalReceipt);
    expect(warrantyPreview.getAttribute("src")).toBe(originalWarranty);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(tabs);
    await user.click(screen.getByRole("tab", { name: "Receipt" }));
    expect(custom.closest("[hidden]")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Warranty" }));
    expect(warrantyPreview.closest("[hidden]")).toBeNull();
  }

  await user.click(screen.getByRole("button", { name: "Delta saw" }));
  await waitFor(() => expect(app.definitionReads).toHaveLength(5));
  await act(async () => app.definitionReads[4]!.release(Response.json([{ name: "receipt" }])));
  expect(custom.getAttribute("src")).toBe(`/files/userfiles/${laterReceipt}`);
  expect(warrantyPreview.getAttribute("src")).toBe(originalWarranty);
  await user.click(screen.getByRole("tab", { name: "Warranty" }));
  expect(warrantyPreview.closest("[hidden]")).toBeNull();
  // A real empty nonnull metadata map still starts the read; omitted tabs stay bound.
  app.rows.find((row) => row.id === 4)!.userfields = {};
  await user.click(screen.getByRole("button", { name: "Delta saw" }));
  await waitFor(() => expect(app.definitionReads).toHaveLength(6));
  await act(async () => app.definitionReads[5]!.release(Response.json([{ name: "warranty" }])));
  await user.click(screen.getByRole("tab", { name: "Warranty" }));
  expect(warrantyPreview.closest("[hidden]")).not.toBeNull();
  expect(warrantyPreview.getAttribute("src")).toBe(originalWarranty);
  expect(custom.getAttribute("src")).toBe(`/files/userfiles/${laterReceipt}`);
  await user.click(screen.getByRole("tab", { name: "Receipt" }));
  expect(custom.closest("[hidden]")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Numeric radio" }));
  await waitFor(() => expect(app.definitionReads).toHaveLength(7));
  await act(async () => app.definitionReads[6]!.release(Response.json([{ name: "0" }])));
  await user.click(screen.getByRole("tab", { name: "Numeric document" }));
  expect(numeric.getAttribute("src")).toBe(`/files/userfiles/${laterReceipt}`);
  expect(numeric.closest("[hidden]")).toBeNull();
  expect(custom.getAttribute("src")).toBe(`/files/userfiles/${laterReceipt}`);
  expect(warrantyPreview.getAttribute("src")).toBe(originalWarranty);
  expect(app.definitionReads.every((read) => read.path === filteredDefinitions)).toBe(true);
  expect(logger).toHaveBeenCalledOnce();
  expect(app.documentReads).toEqual([]);
});

test("search excludes hidden metadata, literal all clears, and filters do not replace the selected detail", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Alpha mixer" });
  await user.click(screen.getByRole("button", { name: "Zulu drill" }));
  await within(screen.getByRole("tabpanel", { name: "Notes" })).findByText("Drill notes");
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Do not search");
  expect(screen.queryByRole("button", { name: "Alpha mixer" })).toBeNull();
  await user.clear(screen.getByRole("searchbox", { name: "Search" }));
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "all");
  expect(screen.getByRole("button", { name: "Alpha mixer" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(
    within(screen.getByRole("tabpanel", { name: "Notes" })).getByText("Drill notes"),
  ).toBeTruthy();
});

test("saved columns and order choose the initial row without reselecting after later sorts", async () => {
  const app = mount({
    layout: JSON.stringify({
      time: 1,
      order: [[1, "desc"]],
      columns: [{ visible: true }, { visible: true }, { visible: false }],
      ColReorder: [0, 1, 2],
    }),
  });

  await screen.findByRole("columnheader", { name: "Name" });
  expect(screen.queryByRole("columnheader", { name: "Owner note" })).toBeNull();
  await waitFor(() => expect(app.detailReads).toEqual([2]));
  await userEvent.setup().click(screen.getByRole("button", { name: "Name" }));
  expect(equipmentRow("Zulu drill").getAttribute("aria-selected")).toBe("true");
  expect(app.detailReads).toEqual([2]);
});

test("replaced selections apply detail responses in completion order within their page", async () => {
  const app = mount({ heldDetails: true });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Beta radio" });
  await waitFor(() => expect(app.detailReplies).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Beta radio" }));
  await waitFor(() => expect(app.detailReplies).toHaveLength(2));
  await act(async () => app.detailReplies[1]!.resolve());
  await within(screen.getByRole("tabpanel", { name: "Notes" })).findByText("Radio notes");
  await act(async () => app.detailReplies[0]!.resolve());
  await screen.findByRole("tabpanel", { name: "Instruction manual" });
  expect(equipmentRow("Beta radio").getAttribute("aria-selected")).toBe("true");
  expect(
    within(screen.getByRole("tabpanel", { name: "Instruction manual" })).getByRole("heading", {
      name: "Alpha mixer",
    }),
  ).toBeTruthy();
});

test.each(["selected detail", "native selected detail", "file definitions"] as const)(
  "departure during %s retires late followups",
  async (stage) => {
    const nested = stage === "file definitions";
    const native = nested || stage === "native selected detail";
    const app = mount({ heldDetails: true, cookieSession: native, heldDefinitions: nested });
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    await waitFor(() => expect(app.detailReplies).toHaveLength(1));

    if (nested) {
      await act(async () => app.detailReplies[0]!.resolve());
      await waitFor(() => expect(app.definitionReads).toHaveLength(1));
    } else {
      app.rows.splice(
        app.rows.findIndex((row) => row.id === 3),
        1,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Beta radio" }));
      await waitFor(() => expect(app.detailReplies).toHaveLength(2));
    }

    await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
    await screen.findByRole("heading", { name: "Settings" });

    if (nested) {
      expect(app.definitionReads[0]!.signal?.aborted).toBe(true);
      await act(async () =>
        app.definitionReads[0]!.release(
          Response.json({ error_message: "Retired definitions error" }, { status: 503 }),
        ),
      );
      expect(logger).not.toHaveBeenCalled();
      expect(screen.queryByText("Retired definitions error")).toBeNull();
    } else {
      await act(async () => {
        app.detailReplies[0]!.resolve();
        app.detailReplies[1]!.resolve();
      });
      expect(logger).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(app.definitionReads).toEqual([]);
      expect(
        app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/v2/content/equipment/1"),
      ).toBe(false);
    }

    expect(app.documentReads).toEqual([]);
    expect(screen.queryByText("Alpha mixer")).toBeNull();
  },
);

test.each(["selected detail", "file definitions"] as const)(
  "table reset retires a held %s and allows the new selection to finish",
  async (stage) => {
    const nested = stage === "file definitions";
    const app = mount({ heldDetails: true, cookieSession: nested, heldDefinitions: nested });
    const user = userEvent.setup();
    await waitFor(() => expect(app.detailReplies).toHaveLength(1));

    if (nested) {
      await act(async () => app.detailReplies[0]!.resolve());
      await waitFor(() => expect(app.definitionReads).toHaveLength(1));
    }

    app.rows.find((row) => row.id === 1)!.name = "Changed mixer";
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
        name: "Reset",
      }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
      ).getByRole("button", { name: "Yes" }),
    );
    await waitFor(() => expect(app.detailReplies).toHaveLength(2));
    expect(app.detailReplies[1]?.id).toBe(3);
    await act(async () => app.detailReplies[1]!.resolve());
    await within(screen.getByRole("tabpanel", { name: "Notes" })).findByText("Radio notes");

    if (nested) {
      await waitFor(() => expect(app.definitionReads).toHaveLength(2));
      expect(app.definitionReads[0]!.signal?.aborted).toBe(true);
      await act(async () => app.definitionReads[1]!.release(Response.json([{ name: "receipt" }])));
      const custom = document.getElementById("equipment-file-3-panel")!.querySelector("embed")!;
      expect(custom.getAttribute("src")).toBe("");
      await act(async () => app.definitionReads[0]!.release(Response.json([{ name: "receipt" }])));
      expect(custom.getAttribute("src")).toBe("");
      await user.click(screen.getByRole("tab", { name: "Receipt" }));
      expect(custom.closest("[hidden]")).not.toBeNull();
      await user.click(screen.getByRole("tab", { name: "Notes" }));
      expect(
        within(screen.getByRole("tabpanel", { name: "Notes" })).getByText("Radio notes"),
      ).toBeTruthy();
    } else {
      await act(async () => app.detailReplies[0]!.resolve());
    }

    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(app.documentReads).toEqual([]);
  },
);

test.each(["success", "cookie missing", "API-key missing", "retired cookie missing"] as const)(
  "Delete %s closes confirmation before applying its response policy",
  async (outcome) => {
    if (outcome === "success") {
      const app = mount({ heldDelete: true, path: "/equipment?keep=1" });
      const user = userEvent.setup();
      const row = (await screen.findByRole("button", { name: "Alpha mixer" })).closest("tr")!;
      await user.click(within(row).getByRole("button", { name: "More" }));
      await user.click(within(row).getByRole("menuitem", { name: "Delete this item" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
          name: "Yes",
        }),
      );
      await waitFor(() => expect(app.writes).toEqual(["/api/objects/equipment/1"]));
      expect(screen.queryByRole("dialog")).toBeNull();
      await user.type(screen.getByRole("searchbox", { name: "Search" }), "Beta");
      await act(async () => app.releaseDelete());
      await waitFor(() => expect(app.listReads()).toBe(2));
      await screen.findByRole("button", { name: "Zulu drill" });
      expect(screen.queryByRole("button", { name: "Alpha mixer" })).toBeNull();
      expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
      expect(app.router.history.location.search).toBe("");

      return;
    }

    const retired = outcome === "retired cookie missing";
    const native = outcome !== "API-key missing";
    const app = mount({ heldDelete: true, path: "/equipment?keep=1", cookieSession: native });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Alpha mixer" });

    const manual = await screen.findByLabelText<HTMLEmbedElement | HTMLObjectElement>(
      "Instruction manual",
      { selector: native ? "embed" : "object" },
    );

    await user.click(screen.getByRole("tab", { name: "Receipt" }));
    const receiptPanel = screen.getByRole("tabpanel", { name: "Receipt" });

    const preview = await within(receiptPanel).findByLabelText<
      HTMLEmbedElement | HTMLObjectElement
    >("Receipt", { selector: native ? "embed" : "object" });

    const attribute = native ? "src" : "data";
    await waitFor(() => expect(preview.getAttribute(attribute)).not.toBe(""));
    const manualSource = manual.getAttribute(attribute);
    const customSource = preview.getAttribute(attribute);
    const definitionsBefore = app.definitionReads.length;
    expect(definitionsBefore).toBe(native ? 1 : 0);
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" });
    await user.type(search, "Beta");
    const row = equipmentRow("Beta radio");
    app.rows.splice(
      app.rows.findIndex((record) => record.id === 3),
      1,
    );
    await user.click(within(row).getByRole("button", { name: "More" }));
    await user.click(within(row).getByRole("menuitem", { name: "Delete this item" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
        name: "Yes",
      }),
    );
    await waitFor(() => expect(app.writes).toEqual(["/api/objects/equipment/3"]));
    expect(app.client.isMutating()).toBeGreaterThan(0);

    const request = app.fetchMock.mock.calls.find(
      ([path, init]) => String(path) === "/api/objects/equipment/3" && init?.method === "DELETE",
    )!;

    expect(request[1]?.signal?.aborted).toBe(false);

    const expectRetainedView = () => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(equipmentRow("Beta radio")).toBe(row);
      expect(search.value).toBe("Beta");
      expect(app.router.history.location.search).toBe("?keep=1");
      expect(app.listReads()).toBe(1);
      expect(app.definitionReads).toHaveLength(definitionsBefore);
      expect(screen.getByRole("tab", { name: "Receipt" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(within(receiptPanel).getByRole("heading", { name: "Alpha mixer" })).toBeTruthy();
      expect(
        screen.getByLabelText("Instruction manual", { selector: native ? "embed" : "object" }),
      ).toBe(manual);
      expect(
        within(receiptPanel).getByLabelText("Receipt", { selector: native ? "embed" : "object" }),
      ).toBe(preview);
      expect(manual.getAttribute(attribute)).toBe(manualSource);
      expect(preview.getAttribute(attribute)).toBe(customSource);
    };

    expectRetainedView();
    expect(logger).not.toHaveBeenCalled();
    let readsBeforeReply = app.listReads();
    let retiredHeading: HTMLElement | undefined;

    if (retired) {
      await act(async () =>
        app.router.navigate({ to: "/settings", search: { tab: "connection" } }),
      );
      retiredHeading = await screen.findByRole("heading", { name: "Settings" });
      expect(request[1]?.signal?.aborted).toBe(true);
      // Navigation can independently read the equipment catalog before the held reply.
      readsBeforeReply = app.listReads();
    }

    await act(async () => app.releaseDelete());
    // Public MutationCache state establishes real rejection settlement for the silent control too.
    await waitFor(() => expect(app.client.isMutating()).toBe(0));

    if (retired) {
      expect(logger).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("Alpha mixer")).toBeNull();
      expect(screen.getByRole("heading", { name: "Settings" })).toBe(retiredHeading);
      expect(app.router.state.location.pathname).toBe("/settings");
      expect(app.listReads()).toBe(readsBeforeReply);
    } else {
      expectRetainedView();

      if (native) {
        expect(logger).toHaveBeenCalledOnce();
        expect(logger.mock.calls[0]?.[0]).toMatchObject({
          status: 400,
          message: "Object not found",
        });
      } else {
        expect(logger).not.toHaveBeenCalled();
      }
    }
  },
);

test("Manage opens the equipment generic editor and direct selected edit routes render their own form", async () => {
  const app = mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Alpha mixer" });
  await user.click(await within(screen.getByRole("main")).findByRole("link", { name: "Manage" }));
  await screen.findByRole("heading", { name: "Manage household data" });
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Data type" }).value).toBe(
    "equipment",
  );
  await screen.findByRole("button", { name: /Edit.*Alpha mixer/ });
  await act(async () => app.router.navigate({ to: "/equipment" }));
  await user.click(await screen.findByRole("link", { name: "Edit Alpha mixer" }));
  await screen.findByRole("heading", { name: "Edit equipment" });
  expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
  expect(app.router.state.location.pathname).toBe("/equipment/1");
});
