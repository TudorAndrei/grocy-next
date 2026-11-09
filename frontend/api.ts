/** The client sends Grocy's public contract; all domain decisions stay on the server. */
export type Row = Record<string, any>;
export class Api {
  readonly base: string;
  constructor(
    base: string,
    private key: string,
    private onUnauthorized?: () => void,
  ) {
    const url = new URL(base.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Enter an HTTP or HTTPS server URL without credentials, a query, or a fragment.",
      );
    this.base = url.href.replace(/\/+$/, "");
    if (!key.trim()) throw new Error("Enter your API key.");
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        headers: {
          "GROCY-API-KEY": this.key.trim(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      // The caller cancelled: pass the abort through untouched.
      if (signal?.aborted) throw e;
      if ((e as Error)?.name === "TimeoutError")
        throw new Error(
          `${this.base} didn't respond within 20 seconds. Check the server and try again.`,
        );
      // Browsers report a stopped server and a blocked origin (CORS) the same way.
      throw new Error(
        `Can't reach ${this.base}. Check that the server is running at this address and allows requests from this page.`,
      );
    }
    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      if (response.status === 401) this.onUnauthorized?.();
      const detail = data?.message ?? data?.detail ?? data?.error_message;
      throw new Error(
        response.status === 401
          ? "API key rejected. Check your connection settings."
          : typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail
                  .map((d: Row) => `${d.loc?.join(".")}: ${d.msg}`)
                  .join("; ")
              : `Request failed (${response.status}).`,
      );
    }
    if (text && data === null)
      throw new Error(
        "The server returned an unexpected response. Check the server URL.",
      );
    return data as T;
  }
  objects(entity: string) {
    return this.request<Row[]>(`/api/objects/${entity}`);
  }
  save(entity: string, body: Row, id?: number) {
    return this.request(
      `/api/objects/${entity}${id == null ? "" : `/${id}`}`,
      id == null ? "POST" : "PUT",
      body,
    );
  }
  post(path: string, body: unknown = {}) {
    return this.request(path, "POST", body);
  }
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function positive(value: string, allowZero = false): number {
  const amount = Number(value);
  if (
    !value.trim() ||
    !Number.isFinite(amount) ||
    (allowZero ? amount < 0 : amount <= 0)
  )
    throw new Error(
      allowZero
        ? "Enter a quantity of zero or more."
        : "Enter a quantity greater than zero.",
    );
  return amount;
}
export function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
