import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BarcodeFormat, Result } from "@zxing/library";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { Route } from "@/routes/barcode";

type DecodeCallback = Parameters<BrowserMultiFormatReader["decodeFromVideoElement"]>[1];

const decoder = {
  callbacks: new Array<DecodeCallback>(),
  stop: vi.fn(),
};

beforeEach(() => {
  decoder.callbacks.length = 0;
  decoder.stop.mockClear();
  vi.spyOn(BrowserMultiFormatReader.prototype, "decodeFromVideoElement").mockImplementation(
    async (_video, callback) => {
      decoder.callbacks.push(callback);

      return { stop: decoder.stop };
    },
  );

  for (const method of ["showModal", "close"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method);
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        const wasOpen = this.open;
        this.open = method === "showModal";

        if (method === "close" && wasOpen)
          queueMicrotask(() => this.dispatchEvent(new Event("close")));
      },
    });
    onTestFinished(() => {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
  }
});

function mount({
  disabled = false,
  autoTorch = true,
}: { disabled?: boolean | string; autoTorch?: boolean } = {}) {
  const writes: string[] = [];
  const stop = vi.fn();
  const constraints = vi.fn(async () => {});

  class CameraTrack extends EventTarget implements MediaStreamTrack {
    id = "rear";
    kind = "video";
    label = "Rear camera";
    enabled = true;
    muted = false;
    readyState: MediaStreamTrackState = "live";
    contentHint = "";
    onended: MediaStreamTrack["onended"] = null;
    onmute: MediaStreamTrack["onmute"] = null;
    onunmute: MediaStreamTrack["onunmute"] = null;
    stop = stop;
    applyConstraints = constraints;
    getCapabilities() {
      return { deviceId: "rear", torch: true };
    }
    getSettings() {
      return { deviceId: "rear" };
    }
    getConstraints() {
      return {};
    }
    clone() {
      return this;
    }
  }

  const track = new CameraTrack();

  const stream: MediaStream = Object.assign(new EventTarget(), {
    id: "camera-stream",
    active: true,
    onaddtrack: null,
    onremovetrack: null,
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
    getTrackById: () => track,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: () => stream,
  });

  const getUserMedia = vi
    .fn<typeof navigator.mediaDevices.getUserMedia>()
    .mockResolvedValue(stream);

  const devices = [
    { deviceId: "rear", label: "Rear camera", kind: "videoinput" },
    { deviceId: "front", label: "Front camera", kind: "videoinput" },
  ];

  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => devices },
  });
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: disabled,
          FEATURE_FLAG_AUTO_TORCH_ON_WITH_CAMERA: autoTorch,
        });

      if (path === "/api/user/settings") return Response.json({ scan_mode_purchase_enabled: true });

      if (init?.method === "POST") {
        writes.push(path);

        return Response.json([]);
      }

      return Response.json([]);
    }),
  );

  const router = createRouter({
    routeTree: createRootRoute({ component: Route.options.component }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    </QueryClientProvider>,
  );

  return { writes, stop, constraints, getUserMedia, stream, view, user: userEvent.setup() };
}

test("a camera result performs one selected action and stops the camera", async () => {
  const { writes, stop, constraints, user } = mount({ disabled: "0" });
  await user.click(await screen.findByRole("button", { name: "Scan with camera" }));
  await screen.findByRole("option", { name: "Rear camera" });
  await waitFor(() => expect(constraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] }));
  await waitFor(() => expect(decoder.callbacks).toHaveLength(1));
  const result = new Result("123", new Uint8Array(), 0, [], BarcodeFormat.EAN_13);
  act(() => {
    decoder.callbacks[0](result, undefined, { stop: decoder.stop });
    decoder.callbacks[0](result, undefined, { stop: decoder.stop });
  });
  await waitFor(() => expect(writes).toEqual(["/api/stock/products/by-barcode/123/add"]));
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("camera selection is saved and switching or closing releases the old stream", async () => {
  const { stop, getUserMedia, constraints, user, view } = mount({ autoTorch: false });
  await user.click(await screen.findByRole("button", { name: "Scan with camera" }));
  await screen.findByRole("option", { name: "Front camera" });
  await user.selectOptions(screen.getByLabelText("Camera"), "front");
  await waitFor(() =>
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { deviceId: { exact: "front" } },
    }),
  );
  expect(localStorage.getItem("cameraId")).toBe("front");
  expect(stop).toHaveBeenCalled();
  await waitFor(() => expect(decoder.callbacks).toHaveLength(2));
  expect(constraints).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Turn torch on" }));
  await waitFor(() => expect(constraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] }));
  view.unmount();
  expect(decoder.stop).toHaveBeenCalled();
});

test("closing during camera permission stops a stream that arrives later", async () => {
  const { stop, getUserMedia, stream, user } = mount();
  let grant: ((value: MediaStream) => void) | undefined;

  const permission = new Promise<MediaStream>((resolve) => {
    grant = resolve;
  });

  getUserMedia.mockReturnValueOnce(permission);
  await user.click(await screen.findByRole("button", { name: "Scan with camera" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Close camera" }));
  await act(async () => {
    grant?.(stream);
  });
  expect(stop).toHaveBeenCalled();
  expect(decoder.callbacks).toHaveLength(0);
});

test("camera denial clears the saved camera and keeps manual entry available", async () => {
  localStorage.setItem("cameraId", "removed-camera");
  const { getUserMedia, user } = mount();
  getUserMedia.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
  await user.click(await screen.findByRole("button", { name: "Scan with camera" }));
  await screen.findByText(/Camera access failed/);
  expect(localStorage.getItem("cameraId")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close camera" }));
  await user.type(screen.getByLabelText("Barcode"), "456");
  expect(screen.getByLabelText<HTMLInputElement>("Barcode").value).toBe("456");
});

test.each([true, "off"])(
  "the legacy camera disable flag (%s) blocks camera access",
  async (disabled) => {
    const { getUserMedia } = mount({ disabled });
    await screen.findByRole("option", { name: "Purchase" });
    expect(screen.queryByRole("button", { name: "Scan with camera" })).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  },
);
