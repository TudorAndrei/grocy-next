import { cleanup, signal, Text, View } from "nsh";
import { message } from "./api";
import { Action, Icon, Note } from "./ui";
/** A request belongs to the mounted screen; old results never replace a newer load. */
export function remote<T>(load: (signal: AbortSignal) => Promise<T>) {
  const data = signal<T | null>(null),
    error = signal(""),
    loading = signal(true);
  let controller: AbortController | undefined;
  let alive = true;
  async function refresh() {
    if (!alive) return;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.set(true);
    error.set("");
    try {
      const result = await load(current.signal);
      if (!current.signal.aborted) data.set(result);
    } catch (e) {
      if (!current.signal.aborted) error.set(message(e));
    } finally {
      if (!current.signal.aborted) loading.set(false);
    }
  }
  cleanup(() => {
    alive = false;
    controller?.abort();
  });
  void refresh();
  return { data, error, loading, refresh };
}
export function LoadState(p: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  return (
    <View
      class="gap-3"
      style={{ display: p.loading || p.error ? "flex" : "none" }}
    >
      {p.loading ? (
        <View class="gap-2">
          <View class="h-3 w-40 rounded bg-secondary" />
          <View class="h-3 w-64 rounded bg-secondary" />
          <Note>Loading…</Note>
        </View>
      ) : null}
      {p.error ? (
        <View class="gap-3">
          <Note error>{p.error}</Note>
          <Action label="Try again" onPress={p.retry} />
        </View>
      ) : null}
    </View>
  );
}
/** Bumped after every successful write, so shell-level summaries (rail counts) can refetch. */
export const changes = signal(0);
export function operations(refresh: () => Promise<void>) {
  let active = true;
  cleanup(() => {
    active = false;
  });
  const busy = signal(false),
    error = signal(""),
    success = signal("");
  async function run(action: () => Promise<unknown>, text = "Saved.") {
    if (!active || busy()) return false;
    busy.set(true);
    error.set("");
    success.set("");
    try {
      await action();
      if (!active) return false;
      await refresh();
      changes.set(changes() + 1);
      if (!active) return false;
      success.set(text);
      return true;
    } catch (e) {
      if (active) error.set(message(e));
      return false;
    } finally {
      if (active) busy.set(false);
    }
  }
  return { busy, error, success, run, alive: () => active };
}
export function Feedback(p: { error: string; success: string }) {
  return (
    <View
      class={`flex-row items-center gap-2 rounded-lg px-3 py-2 ${p.error ? "bg-danger-soft" : "bg-secondary"}`}
      style={{ display: p.error || p.success ? "flex" : "none" }}
    >
      <Icon
        name={p.error ? "alert" : "check"}
        size={15}
        tint={p.error ? "destructive" : "foreground"}
      />
      <View class="flex-1 min-w-0">
        {p.error ? <Note error>{p.error}</Note> : null}
        {p.success && !p.error ? (
          <Text class="text-sm text-foreground">{p.success}</Text>
        ) : null}
      </View>
    </View>
  );
}
