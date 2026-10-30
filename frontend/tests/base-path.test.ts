import { expect, onTestFinished, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { readApiConfig, writeApiConfig } from "@/lib/config";
import { downloadApiDocument } from "@/lib/open-document";

test.each(["/", "/house", "/house/"])(
  "price chart scripts load under the %s web base path",
  async (base) => {
    vi.stubEnv("BASE_URL", base);
    vi.resetModules();

    class Chart {
      destroy = vi.fn();
    }

    window.Chart = Chart;

    onTestFinished(() => {
      vi.unstubAllEnvs();
      delete window.Chart;
      document.head.querySelectorAll("script").forEach((element) => element.remove());
    });

    const { createPriceChart } = await import("@/lib/price-chart");

    const chart = createPriceChart(
      document.createElement("canvas"),
      [],
      1,
      "Unknown store",
      "USD",
      2,
      new AbortController().signal,
    );

    const prefix = base === "/" ? "" : "/house";

    for (const filename of ["Chart.min.js", "chartjs-plugin-trendline.min.js"]) {
      const path = `${prefix}/vendor/chartjs/${filename}`;
      await waitFor(() =>
        expect(document.head.querySelector(`script[src="${path}"]`)).not.toBeNull(),
      );
      document.head.querySelector(`script[src="${path}"]`)!.dispatchEvent(new Event("load"));
    }

    expect(await chart).toBeInstanceOf(Chart);
  },
);

test("the deployed base path applies to API requests and authenticated downloads", async () => {
  vi.stubEnv("BASE_URL", "/grocy/");
  vi.stubEnv("VITE_API_BASE", "");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("dev-key");

    return String(input).endsWith("/api/system/config")
      ? Response.json({ FEATURE_FLAG_STOCK: true })
      : new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
          headers: { "Content-Type": "text/calendar" },
        });
  });

  vi.stubGlobal("fetch", fetchMock);
  const documents: Blob[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        documents.push(blob);

        return "blob:calendar";
      }
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  expect(await api.getSystemConfig()).toEqual({ FEATURE_FLAG_STOCK: true });
  await downloadApiDocument("/api/calendar/ical", "Grocy.ics");
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/grocy/api/system/config",
    "/grocy/api/calendar/ical",
  ]);
  expect(click).toHaveBeenCalledOnce();
  expect(await documents[0]?.text()).toContain("BEGIN:VCALENDAR");
});

test("an explicit API base keeps priority over the web deployment path", async () => {
  vi.stubEnv("BASE_URL", "/grocy/");
  vi.stubEnv("VITE_API_BASE", "https://api.example.test/kitchen");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ needs_setup: false }));
  vi.stubGlobal("fetch", fetchMock);
  await api.setupStatus();
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
    "https://api.example.test/kitchen/api/v2/setup",
  );
  writeApiConfig({ baseUrl: "/saved", apiKey: "saved-key" });
  expect(readApiConfig()).toEqual({ baseUrl: "/saved", apiKey: "saved-key" });
});
