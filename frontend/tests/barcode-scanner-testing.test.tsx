import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, Result } from "@zxing/library";
import { mountNativeEditor } from "./fixtures/native-editor";

function mountScanner(path = "/barcodescannertesting", camera = true) {
  return mountNativeEditor(
    path,
    (url) => {
      if (url === "/api/v2/user/permissions") return Response.json({});

      return undefined;
    },
    { FEATURE_FLAG_STOCK: false, FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: !camera },
  );
}

function counts() {
  return [
    screen.getByLabelText("Hit count").textContent,
    screen.getByLabelText("Miss count").textContent,
  ];
}

test("native scanner testing is available without stock or write grants and enables its scan controls only on expected keyup", async () => {
  const app = mountScanner();
  const expected = await screen.findByLabelText<HTMLInputElement>("Expected barcode");
  const scan = screen.getByLabelText<HTMLInputElement>("Scan field");
  expect(expected.required).toBe(true);
  expect(scan.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Scan with camera" }).disabled).toBe(
    true,
  );
  fireEvent.change(expected, { target: { value: "AB" } });
  expect(scan.disabled).toBe(true);
  fireEvent.keyUp(expected, { key: "B" });
  expect(scan.disabled).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Scan with camera" }).disabled).toBe(
    false,
  );
  fireEvent.change(expected, { target: { value: "A" } });
  fireEvent.keyUp(expected, { key: "Backspace" });
  expect(scan.disabled).toBe(true);
  expect(counts()).toEqual(["0", "0"]);
  expect(
    app.fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/stock/") ||
        ["POST", "PUT", "DELETE"].includes(init?.method ?? ""),
    ),
  ).toEqual([]);
});

test.each([
  ["?barcode=0012&barcode=99", "0012", true],
  ["?barcode=%2B01%20", "+01 ", true],
  ["?barcode&barcode=99", "true", true],
  ["?barcode=", "", false],
] as const)(
  "native barcode prefill %s retains its first raw value and delayed focus",
  async (query, value, enabled) => {
    mountScanner(`/barcodescannertesting${query}`);
    const expected = await screen.findByLabelText<HTMLInputElement>("Expected barcode");
    const scan = screen.getByLabelText<HTMLInputElement>("Scan field");
    expect(expected.value).toBe(value);
    expect(scan.disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(enabled ? scan : expected));
    expect(scan.disabled).toBe(!enabled);
  },
);

test("Enter and blur retain rapid duplicate results, exact whitespace and newest-first hit/miss history", async () => {
  const app = mountScanner();
  const expected = await screen.findByLabelText<HTMLInputElement>("Expected barcode");
  const scan = screen.getByLabelText<HTMLInputElement>("Scan field");
  fireEvent.change(expected, { target: { value: "Code " } });
  fireEvent.keyUp(expected, { key: " " });
  fireEvent.change(scan, { target: { value: " Code" } });
  fireEvent.keyDown(scan, { key: "Enter" });
  fireEvent.change(scan, { target: { value: "Code " } });
  fireEvent.keyDown(scan, { key: "Enter" });
  fireEvent.blur(scan);
  expect(counts()).toEqual(["2", "1"]);

  const options = within(screen.getByRole("listbox", { name: "Scanned barcodes" })).getAllByRole(
    "option",
  );

  expect(options.map((option) => option.textContent)).toEqual(["Code ", "Code ", " Code"]);
  expect(options.map((option) => option.dataset.result)).toEqual(["hit", "hit", "miss"]);
  fireEvent.change(scan, { target: { value: "" } });
  fireEvent.keyDown(scan, { key: "Enter" });
  fireEvent.blur(scan);
  expect(counts()).toEqual(["2", "1"]);
  expect(
    app.fetchMock.mock.calls.filter(([, init]) =>
      ["POST", "PUT", "DELETE"].includes(init?.method ?? ""),
    ),
  ).toEqual([]);
});

test("native clear timers change from 500ms to zero after initialization and retain expected-field focus", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const app = mountScanner("/barcodescannertesting?barcode=12");
  await act(async () => {
    await app.router.load();
  });

  for (let attempt = 0; attempt < 20 && !screen.queryByLabelText("Expected barcode"); attempt++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }

  const expected = screen.getByLabelText<HTMLInputElement>("Expected barcode");
  const scan = screen.getByLabelText<HTMLInputElement>("Scan field");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(document.activeElement).toBe(scan);
  fireEvent.change(scan, { target: { value: "12" } });
  fireEvent.keyDown(scan, { key: "Enter" });
  expect(scan.value).toBe("12");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(499);
  });
  expect(scan.value).toBe("12");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(scan.value).toBe("");
  expect(document.activeElement).toBe(scan);
  fireEvent.change(scan, { target: { value: "12" } });
  fireEvent.keyDown(scan, { key: "Enter" });
  act(() => expected.focus());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(scan.value).toBe("");
  expect(document.activeElement).toBe(expected);
  // Focusing expected also blurs the uncleared scan before its zero-delay clear.
  expect(counts()).toEqual(["3", "0"]);
});

test("disabling browser camera scanning preserves the keyboard-only diagnostic", async () => {
  mountScanner("/barcodescannertesting", false);
  const expected = await screen.findByLabelText("Expected barcode");
  await userEvent.type(expected, "123");
  expect(screen.queryByRole("button", { name: "Scan with camera" })).toBeNull();
  const scan = screen.getByLabelText<HTMLInputElement>("Scan field");
  expect(scan.disabled).toBe(false);
  fireEvent.change(scan, { target: { value: "123" } });
  fireEvent.keyDown(scan, { key: "Enter" });
  expect(counts()).toEqual(["1", "0"]);
});

test("a camera result enters diagnostic history once, releases the stream and performs no stock operation", async () => {
  const stop = vi.fn();
  const controls = { stop: vi.fn() };
  const track = { stop, getSettings: () => ({ deviceId: "rear" }), getCapabilities: () => ({}) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => stream, enumerateDevices: async () => [] },
  });
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  type DecodeCallback = Parameters<BrowserMultiFormatReader["decodeFromVideoElement"]>[1];

  let decode: DecodeCallback | undefined;

  const decoder = vi
    .spyOn(BrowserMultiFormatReader.prototype, "decodeFromVideoElement")
    .mockImplementation(async (_video, callback) => {
      decode = callback;

      return controls;
    });

  onTestFinished(() => decoder.mockRestore());
  const app = mountScanner("/barcodescannertesting?barcode=0012");
  const scan = await screen.findByLabelText<HTMLInputElement>("Scan field");
  await waitFor(() => expect(scan.disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
  await waitFor(() => expect(decode).toBeDefined());
  const result = new Result("0012", new Uint8Array(), 0, [], BarcodeFormat.CODE_128);
  act(() => {
    decode?.(result, undefined, controls);
    decode?.(result, undefined, controls);
  });
  expect(counts()).toEqual(["1", "0"]);
  expect(
    within(screen.getByRole("listbox", { name: "Scanned barcodes" }))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["0012"]);
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    app.fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/stock/") ||
        ["POST", "PUT", "DELETE"].includes(init?.method ?? ""),
    ),
  ).toEqual([]);
});
