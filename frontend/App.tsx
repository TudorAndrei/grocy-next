import { effect, mount, signal, Storage, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, message, type Row } from "./api";
import { changes, remote } from "./data";
import { Action, Count, dueDays, Field, Heading, Icon, Note, type IconName } from "./ui";
import { Nutrition } from "./screens/Nutrition";
import { Stock } from "./screens/Stock";
import { Shopping } from "./screens/Shopping";
import { Meals } from "./screens/Cooking";
import { Household } from "./screens/Household";
import { Catalog } from "./screens/Catalog";
function App() {
  const client = signal<Api | null>(null),
    server = signal("http://127.0.0.1:8000"),
    key = signal(""),
    error = signal(""),
    connecting = signal(false);
  void Storage.getItem("grocy.server")
    .then((value) => {
      if (value && !client()) server.set(value);
    })
    .catch(() => {});
  async function connect() {
    if (connecting()) return;
    connecting.set(true);
    error.set("");
    try {
      const api = new Api(server(), key(), () => {
        client.set(null);
        error.set("Your session has expired. Enter your API key to reconnect.");
      });
      await api.request("/api/system/info");
      void Storage.setItem("grocy.server", api.base).catch(() => {});
      client.set(api);
      key.set("");
    } catch (e) {
      error.set(message(e));
    } finally {
      connecting.set(false);
    }
  }
  return (
    <View class="flex-1 bg-background font-sans">
      {client() ? (
        <Workspace
          api={client()!}
          onDisconnect={() => {
            client.set(null);
            key.set("");
          }}
        />
      ) : (
        <Scroll class="flex-1">
          <View class="w-full max-w-[400px] self-center px-6 py-16 md:py-24 gap-8">
            <View class="flex-row items-center gap-2.5">
              <Mark />
              <Text class="text-[15px] font-semibold tracking-tight text-foreground">
                Grocy Next
              </Text>
            </View>
            <View class="gap-2">
              <Heading title="Connect your household" />
              <Note>
                Your key stays in memory until you disconnect or reload.
              </Note>
            </View>
            <View class="gap-4">
              <Field
                label="Server URL"
                value={server()}
                onChange={(v) => server.set(v)}
                placeholder="https://grocy.example.com"
              />
              <Field
                label="API key"
                value={key()}
                secret
                onChange={(v) => key.set(v)}
                onSubmit={() => void connect()}
              />
              {error() ? <Note error>{error()}</Note> : null}
              <Action
                label={connecting() ? "Connecting…" : "Connect"}
                primary
                disabled={connecting()}
                onPress={() => void connect()}
              />
            </View>
            <View class="gap-3 pt-6 border-t border-border">
              <Note>
                On another device, use your server’s network address or the web
                origin that proxies the API. Localhost always means this device.
              </Note>
              <View class="self-start">
                <Action
                  label="Use development API key"
                  quiet
                  compact
                  onPress={() => {
                    key.set("dev-key");
                  }}
                />
              </View>
            </View>
          </View>
        </Scroll>
      )}
    </View>
  );
}
function Workspace(p: { api: Api; onDisconnect: () => void }) {
  const page = signal("Stock");
  const pages: { name: string; icon: IconName }[] = [
    { name: "Stock", icon: "package" },
    { name: "Shopping", icon: "cart" },
    { name: "Meals", icon: "utensils" },
    { name: "Chores", icon: "circle-check" },
  ];
  const proposals = remote((s) =>
    p.api.request<Row[]>("/api/v2/nutrition/proposals", "GET", undefined, s),
  );
  const pending = () => proposals.data()?.length ?? 0;
  /** What is waiting to be acted on: items left on the default list, chores overdue or due today. */
  const counts = remote(async (s) => {
    const [lists, tasks, chores, batteries] = await Promise.all([
      p.api.request<Row[]>("/api/v2/shopping-lists", "GET", undefined, s),
      p.api.request<Row>("/api/v2/tasks/overview", "GET", undefined, s),
      p.api.request<Row>("/api/v2/chores/overview", "GET", undefined, s),
      p.api.request<Row>("/api/v2/batteries/overview", "GET", undefined, s),
    ]);
    const list = lists[0]
      ? await p.api.request<Row>(
          `/api/v2/shopping-lists/${lists[0].id}`,
          "GET",
          undefined,
          s,
        )
      : { items: [] };
    const due = (d: unknown) => {
      const n = dueDays(d ? String(d) : null);
      return n != null && n <= 0;
    };
    const rows = (r: Row) => (r.rows ?? []) as Row[];
    return {
      Shopping: (list.items as Row[]).filter((r) => !r.done).length,
      Chores:
        rows(tasks).filter((r) => !Number(r.done) && due(r.due_date)).length +
        rows(chores).filter((r) => due(r.next_estimated_execution_time)).length +
        rows(batteries).filter(
          (r) =>
            Number(r.charge_interval_days) > 0 &&
            due(r.next_estimated_charge_time),
        ).length,
    } as Record<string, number>;
  });
  const count = (name: string) => counts.data()?.[name] ?? 0;
  // Refetch the summaries when the destination changes or any screen saves.
  effect(() => {
    page();
    changes();
    void counts.refresh();
    void proposals.refresh();
  });
  return (
    <View class="flex-1 md:flex-row bg-background">
      <View class="hidden md:flex md:flex-col w-[232px] shrink-0 bg-rail border-r border-border px-3 pt-5 pb-4 gap-6">
        <View class="flex-row items-center gap-2.5 px-2.5">
          <Mark />
          <Text class="text-[15px] font-semibold tracking-tight text-foreground">
            Grocy Next
          </Text>
        </View>
        <View class="gap-0.5">
          <Each of={pages}>
            {(item) => (
              <Nav
                label={item().name}
                icon={item().icon}
                count={count(item().name)}
                selected={page() === item().name}
                onPress={() => page.set(item().name)}
              />
            )}
          </Each>
        </View>
        <View class="flex-1" />
        <View class="gap-0.5">
          <Nav
            label="Review"
            icon="inbox"
            count={pending()}
            strong
            selected={page() === "Review"}
            onPress={() => page.set("Review")}
          />
          <Nav
            label="Settings"
            icon="settings"
            selected={page() === "Settings"}
            onPress={() => page.set("Settings")}
          />
        </View>
      </View>
      <View class="flex-1 min-w-0 min-h-0">
        <View class="md:hidden flex-row items-center justify-between gap-2 pl-4 pr-2 pt-[env(safe-area-inset-top)] min-h-14 border-b border-border bg-background">
          <View class="flex-row items-center gap-2.5">
            <Mark />
            <Text class="text-[15px] font-semibold tracking-tight text-foreground">
              Grocy Next
            </Text>
          </View>
          <View class="flex-row items-center">
            <IconButton
              label={pending() ? `Review, ${pending()} pending` : "Review"}
              icon="inbox"
              count={pending()}
              selected={page() === "Review"}
              onPress={() => page.set("Review")}
            />
            <IconButton
              label="Settings"
              icon="settings"
              selected={page() === "Settings"}
              onPress={() => page.set("Settings")}
            />
          </View>
        </View>
        <Each of={[page()]}>
          {(current) => (
            <Scroll class="flex-1">
              <View class="w-full max-w-[1120px] self-center px-4 pt-5 pb-8 md:px-10 md:pt-8 md:pb-12 gap-6">
                {page() === "Stock" ? <Stock api={p.api} /> : null}
                {page() === "Shopping" ? <Shopping api={p.api} /> : null}
                {page() === "Meals" ? <Meals api={p.api} /> : null}
                {page() === "Chores" ? <Household api={p.api} /> : null}
                {page() === "Review" ? (
                  <View class="gap-5">
                    <View class="gap-1">
                      <View class="flex-row items-center min-h-11">
                        <Heading
                          title="Review"
                          detail={pending() ? `${pending()} pending` : undefined}
                        />
                      </View>
                      <Note>
                        Changes proposed by assistants wait here until you
                        approve them.
                      </Note>
                    </View>
                    <Nutrition
                      api={p.api}
                      onReviewed={() => void proposals.refresh()}
                    />
                  </View>
                ) : null}
                {page() === "Settings" ? (
                  <View class="gap-5">
                    <View class="gap-1">
                      <View class="flex-row justify-between items-center gap-3 min-h-11">
                        <Heading title="Settings" />
                        <Action
                          label="Disconnect"
                          icon="log-out"
                          onPress={p.onDisconnect}
                        />
                      </View>
                      <Note>Connected to {p.api.base}</Note>
                    </View>
                    <Catalog api={p.api} />
                  </View>
                ) : null}
              </View>
            </Scroll>
          )}
        </Each>
        <View class="md:hidden flex-row bg-background border-t border-border pb-[env(safe-area-inset-bottom)]">
          <Each of={pages}>
            {(item) => (
              <View class="flex-1">
                <Tab
                  label={item().name}
                  icon={item().icon}
                  count={count(item().name)}
                  selected={page() === item().name}
                  onPress={() => page.set(item().name)}
                />
              </View>
            )}
          </Each>
        </View>
      </View>
    </View>
  );
}
/** The mark: an ink tile with a saffron corner. */
function Mark() {
  return (
    <View class="w-[22px] h-[22px] rounded-[6px] bg-foreground relative">
      <View class="absolute right-[3px] bottom-[3px] w-[7px] h-[7px] rounded-full bg-primary" />
    </View>
  );
}
function Nav(p: {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  count?: number;
  /** Saffron count: reserved for assistant changes waiting in Review. */
  strong?: boolean;
}) {
  return (
    <Button
      selected={p.selected}
      onPress={p.onPress}
      class={`min-h-9 px-2.5 flex-row items-center gap-2.5 rounded-lg ${p.selected ? "bg-card border border-border shadow-xs" : "border border-transparent hover:bg-accent"} focus:outline-2 focus:outline-offset-2 focus:outline-ring`}
    >
      <Icon
        name={p.icon}
        size={16}
        tint={p.selected ? "foreground" : "muted-foreground"}
      />
      <Text
        class={`flex-1 text-sm ${p.selected ? "font-medium text-foreground" : "text-ink-soft"}`}
      >
        {p.label}
      </Text>
      {p.count ? <Count value={p.count} strong={p.strong} /> : null}
      {p.selected && !p.count ? (
        <View class="w-1.5 h-1.5 rounded-full bg-primary" />
      ) : null}
    </Button>
  );
}
function IconButton(p: {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Button
      accessibilityLabel={p.label}
      selected={p.selected}
      onPress={p.onPress}
      class={`w-11 h-11 rounded-lg items-center justify-center relative ${p.selected ? "bg-selected" : ""} focus:outline-2 focus:outline-ring`}
    >
      <Icon name={p.icon} size={20} tint="foreground" />
      {p.count ? (
        <View class="absolute top-1 right-1">
          <Count value={p.count} strong />
        </View>
      ) : null}
    </Button>
  );
}
function Tab(p: {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Button
      selected={p.selected}
      onPress={p.onPress}
      class="min-h-14 pt-2 pb-1.5 items-center justify-center gap-1 focus:outline-2 focus:outline-ring"
    >
      <View
        class={`absolute top-0 h-0.5 w-8 rounded-full ${p.selected ? "bg-primary" : "bg-transparent"}`}
      />
      <Icon
        name={p.icon}
        size={20}
        tint={p.selected ? "foreground" : "muted-foreground"}
      />
      <Text
        class={`text-[11px] ${p.selected ? "font-medium text-foreground" : "text-muted-foreground"}`}
      >
        {p.label}
      </Text>
      {/* After the label in reading order, so the tab reads "Shopping 2"; drawn on the icon's corner. */}
      {p.count ? (
        <View class="absolute top-1 left-1/2 ml-[3px] min-w-4 h-4 px-1 rounded-full bg-foreground items-center justify-center">
          <Text class="text-[10.5px] leading-4 font-semibold tabular-nums text-background">
            {String(p.count)}
          </Text>
        </View>
      ) : null}
    </Button>
  );
}
mount(App);
