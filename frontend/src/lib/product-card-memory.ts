import {
  getProductOverview,
  getPriceHistory,
  type ProductOverviewData,
  type PriceHistory,
} from "./product-overview";
import { emptyProductCard, refreshProductCard, type ProductCardView } from "./product-card";

type Settings = Parameters<typeof refreshProductCard>[2];

type HistoryRequest = { productId: number; factor: number };

type CardSnapshot = { view: ProductCardView; hasRead: boolean; history: CardHistory };

export type CardHistory = {
  rows: PriceHistory | undefined;
  factor: number;
  pending: number;
  error: Error | undefined;
};

let nextOwner = 0;

/** One native card's retained fields and requests, scoped to its owning page. */
export class ProductCardMemory {
  readonly id = ++nextOwner;
  private scope = new AbortController();
  private settings: Settings | undefined;
  private formatVersion = "";
  private latest: ProductOverviewData | undefined;
  private retry: HistoryRequest | undefined;
  private listeners = new Set<() => void>();
  private snapshot: CardSnapshot = {
    view: emptyProductCard(),
    hasRead: false,
    history: { rows: undefined, factor: 1, pending: 0, error: undefined },
  };

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  mount() {
    if (this.scope.signal.aborted) this.scope = new AbortController();
  }

  dispose() {
    this.scope.abort();
    this.snapshot = { ...this.snapshot, history: { ...this.snapshot.history, pending: 0 } };
  }

  configure(settings: Settings, formatVersion: string) {
    const changed = this.formatVersion !== formatVersion || this.settings?.t !== settings.t;
    this.settings = settings;
    this.formatVersion = formatVersion;

    if (changed && this.latest) this.accept(this.latest, this.scope.signal);
  }

  async read(productId: number) {
    const signal = this.scope.signal;
    const data = await getProductOverview(productId, signal);
    this.accept(data, signal);

    return data;
  }

  retryHistory = () => {
    if (this.retry) void this.readHistory(this.retry, this.scope.signal);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private accept(data: ProductOverviewData, signal: AbortSignal) {
    if (signal.aborted || signal !== this.scope.signal) return;
    this.latest = data;

    if (!this.settings) return;
    const previous = this.snapshot.view;
    const view = refreshProductCard(previous, data, { ...this.settings, now: new Date() });
    this.snapshot = { ...this.snapshot, view, hasRead: true };
    this.emit();

    if (view.history && view.history.revision !== previous.history?.revision)
      void this.readHistory(view.history, signal);
  }

  private async readHistory(request: HistoryRequest, signal: AbortSignal) {
    if (signal.aborted || signal !== this.scope.signal) return;
    this.retry = request;
    this.snapshot = {
      ...this.snapshot,
      history: {
        ...this.snapshot.history,
        pending: this.snapshot.history.pending + 1,
        error: undefined,
      },
    };
    this.emit();

    try {
      const rows = await getPriceHistory(request.productId, signal);

      if (signal.aborted || signal !== this.scope.signal) return;
      this.snapshot = {
        ...this.snapshot,
        history: {
          rows,
          factor: request.factor,
          pending: this.snapshot.history.pending - 1,
          error: undefined,
        },
      };
    } catch (error) {
      if (signal.aborted || signal !== this.scope.signal) return;
      this.retry = request;
      this.snapshot = {
        ...this.snapshot,
        history: {
          ...this.snapshot.history,
          pending: this.snapshot.history.pending - 1,
          error: error instanceof Error ? error : new Error("Could not load price history"),
        },
      };
    }

    this.emit();
  }
}
