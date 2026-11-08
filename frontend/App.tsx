import { mount, signal, Storage, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, message } from "./api";
import { Action, Field, Heading, Note, color } from "./ui";
import { Stock } from "./screens/Stock";
import { Shopping } from "./screens/Shopping";
import { Meals } from "./screens/Cooking";
import { Household } from "./screens/Household";
import { Catalog } from "./screens/Catalog";
import { Batch } from "./screens/Batch";
import { Overview } from "./screens/Overview";
import { NavIcon } from "./icons";
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
    <View class="flex-1 bg-[#f7f7f5] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
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
          <View class="w-full max-w-md self-center px-6 py-12 gap-6">
            <View class="flex-row items-center gap-3">
              <NavIcon name="Stock" color={color.accent} />
              <Text class="text-2xl font-semibold text-[#22603f]">Grocy Next</Text>
            </View>
            <Heading title="Connect your household" />
            <Note>
              Your pantry, shopping lists, and household routines, together. Connect to your Grocy
              server to get started.
            </Note>
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
            <Note>Your key stays in memory until you disconnect or reload.</Note>
            {error() ? <Note error>{error()}</Note> : null}
            <Action
              label={connecting() ? "Connecting…" : "Connect"}
              primary
              disabled={connecting()}
              onPress={() => void connect()}
            />
            <Note>
              On another device, use your server’s network address or the web origin that proxies
              the API. Localhost always means this device.
            </Note>
            <Action
              label="Use development API key"
              quiet
              onPress={() => {
                key.set("dev-key");
              }}
            />
          </View>
        </Scroll>
      )}
    </View>
  );
}
function Workspace(p: { api: Api; onDisconnect: () => void }) {
  const page = signal("Stock"),
    batchMode = signal("Purchase");
  const pages = ["Stock", "Shopping", "Meals", "Chores"];
  return (
    <View class="flex-1 md:flex-row">
      <View class="hidden md:flex md:flex-col w-[224px] shrink-0 bg-white border-r border-[#e4e4e0] px-4 py-7 gap-8">
        <View class="flex-row items-center gap-3 px-2">
          <NavIcon name="Stock" color={color.accent} />
          <Text class="text-lg font-semibold text-[#1b1d1c]">Grocy Next</Text>
        </View>
        <View class="gap-1">
          <Nav
            label="Overview"
            selected={page() === "Overview"}
            onPress={() => page.set("Overview")}
          />
          <Each of={pages}>
            {(name) => (
              <Nav label={name()} selected={page() === name()} onPress={() => page.set(name())} />
            )}
          </Each>
        </View>
        <View class="border-t border-[#e4e4e0] pt-4 gap-2">
          <Nav label="Batch" selected={page() === "Batch"} onPress={() => page.set("Batch")} />
          <Note>Purchase, consume, open, or count several products.</Note>
        </View>
        <View class="flex-1" />
        <Note>{p.api.base}</Note>
        <Nav
          label="Settings"
          selected={page() === "Settings"}
          onPress={() => page.set("Settings")}
        />
      </View>
      <View class="flex-1 min-w-0 min-h-0">
        <View class="md:hidden flex-row items-center justify-between px-4 py-2 border-b border-[#e4e4e0] bg-white">
          <Action label="Overview" quiet onPress={() => page.set("Overview")} />
          <View class="flex-row gap-1">
            <Action label="Batch" quiet onPress={() => page.set("Batch")} />
            <Action label="Settings" quiet onPress={() => page.set("Settings")} />
          </View>
        </View>
        <Each of={[page()]}>
          {() => (
            <Scroll class="flex-1">
              <View class="w-full max-w-[1024px] self-center p-4 md:p-8 gap-5">
                {page() === "Overview" ? (
                  <Overview
                    api={p.api}
                    navigate={(name) => page.set(name)}
                    batch={(name) => {
                      batchMode.set(name);
                      page.set("Batch");
                    }}
                  />
                ) : null}
                {page() === "Batch" ? <Batch api={p.api} initialMode={batchMode()} /> : null}
                {page() === "Stock" ? <Stock api={p.api} /> : null}
                {page() === "Shopping" ? <Shopping api={p.api} /> : null}
                {page() === "Meals" ? <Meals api={p.api} /> : null}
                {page() === "Chores" ? <Household api={p.api} /> : null}
                {page() === "Settings" ? (
                  <View class="gap-5">
                    <View class="flex-row justify-between items-center">
                      <Heading title="Settings" />
                      <Action label="Disconnect" quiet onPress={p.onDisconnect} />
                    </View>
                    <Note>Connected to {p.api.base}</Note>
                    <Catalog api={p.api} />
                  </View>
                ) : null}
              </View>
            </Scroll>
          )}
        </Each>
        <View class="md:hidden flex-row bg-white border-t border-[#e4e4e0] pb-[env(safe-area-inset-bottom)]">
          <Each of={pages}>
            {(name) => (
              <View class="flex-1">
                <Nav label={name()} selected={page() === name()} onPress={() => page.set(name())} />
              </View>
            )}
          </Each>
        </View>
      </View>
    </View>
  );
}
function Nav(p: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Button
      accessibilityLabel={p.label}
      selected={p.selected}
      onPress={p.onPress}
      class="min-h-16 md:min-h-12 px-2 md:px-3 flex-col md:flex-row gap-1 md:gap-3 items-center justify-center md:justify-start rounded-xl hover:bg-[#f0f0ec] focus:outline-2 focus:outline-[#22603f]"
      style={{ backgroundColor: p.selected ? "#edf2ee" : "transparent" }}
    >
      <NavIcon name={p.label} color={p.selected ? color.accent : color.muted} />
      <Text
        style={{
          color: p.selected ? color.accent : color.muted,
          fontSize: 14,
          fontWeight: p.selected ? "600" : "400",
        }}
      >
        {p.label}
      </Text>
    </Button>
  );
}
mount(App);
