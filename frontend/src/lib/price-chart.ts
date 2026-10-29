import moment from "moment/min/moment-with-locales.js";
import type { PriceHistory } from "./product-overview";

type Point = { x: Date; y: number };

function chartOptions(
  history: PriceHistory,
  factor: number,
  unknownStore: string,
  currency: string,
  precision: number,
) {
  const format = (value: number) =>
    value.toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });

  const series = new Map<string, Point[]>([["_TrendlineDataset", []]]);
  const labels: Date[] = [];

  for (const row of history) {
    const name = row.shopping_location ? String(row.shopping_location.name) : unknownStore;
    const point = { x: moment(row.date).toDate(), y: row.price * factor };
    labels.push(point.x);

    if (!series.has(name)) series.set(name, []);
    series.get(name)!.push(point);
    series.get("_TrendlineDataset")!.push(point);
  }

  return {
    type: "line",
    data: {
      labels,
      datasets: Object.keys(Object.fromEntries(series)).map((label, index) => {
        const dataset = {
          data: series.get(label),
          fill: false,
          borderColor: `HSL(${129 * index},100%,50%)`,
          label,
        };

        if (label !== "_TrendlineDataset") return dataset;

        return {
          ...dataset,
          hidden: true,
          alwaysShowTrendline: true,
          trendlineLinear: {
            colorMin: "rgba(0, 0, 0, 0.3)",
            colorMax: "rgba(0, 0, 0, 0.3)",
            lineStyle: "dotted",
            width: 3,
          },
        };
      }),
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        xAxes: [
          {
            type: "time",
            time: {
              parser: "YYYY-MM-DD",
              round: "day",
              tooltipFormat: "YYYY-MM-DD",
              unit: "day",
              unitStepSize: 10,
              displayFormats: { day: "YYYY-MM-DD" },
            },
            ticks: { autoSkip: true, maxRotation: 0 },
          },
        ],
        yAxes: [
          {
            ticks: {
              beginAtZero: true,
              callback: (value: number) => format(Number.parseFloat(String(value))),
            },
          },
        ],
      },
      legend: {
        display: true,
        labels: { filter: (item: { text: string }) => item.text !== "_TrendlineDataset" },
      },
      tooltips: {
        callbacks: {
          label: (
            item: { yLabel: number; datasetIndex: number },
            data: { datasets: { label: string }[] },
          ) => {
            const label = data.datasets[item.datasetIndex]?.label ?? "";

            return `${label ? `${label}: ` : ""}${format(item.yLabel)}`;
          },
        },
      },
    },
  };
}

type ChartConstructor = new (
  canvas: HTMLCanvasElement,
  options: ReturnType<typeof chartOptions>,
) => { destroy: () => void };

declare global {
  interface Window {
    Chart?: ChartConstructor;
    moment?: typeof moment;
  }
}

let library: Promise<ChartConstructor> | undefined;

function script(filename: string) {
  return new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    element.src = `${import.meta.env.BASE_URL}vendor/chartjs/${filename}`;
    element.onload = () => resolve();
    element.onerror = () => {
      element.remove();
      reject(new Error("Could not load price history chart."));
    };

    document.head.append(element);
  });
}

async function chartLibrary() {
  window.moment = moment;
  await script("Chart.min.js");
  await script("chartjs-plugin-trendline.min.js");

  if (!window.Chart) throw new Error("Could not load price history chart.");

  return window.Chart;
}

export async function createPriceChart(
  canvas: HTMLCanvasElement,
  history: PriceHistory,
  factor: number,
  unknownStore: string,
  currency: string,
  precision: number,
  signal: AbortSignal,
) {
  library ??= chartLibrary().catch((error: Error) => {
    library = undefined;
    throw error;
  });
  const Chart = await library;

  signal.throwIfAborted();

  return new Chart(canvas, chartOptions(history, factor, unknownStore, currency, precision));
}
