import { mount, signal, Storage, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Api, message } from "./api";
import { Action, Field, Heading, Note, color } from "./ui";
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
    <View class="flex-1 bg-[#f7f7f5]">
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
            <Text class="text-lg font-semibold text-[#22603f]">Grocy Next</Text>
            <Heading title="Connect your household" />
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
            <Note>
              Your key stays in memory until you disconnect or reload.
            </Note>
            {error() ? <Note error>{error()}</Note> : null}
            <Action
              label={connecting() ? "Connecting…" : "Connect"}
              primary
              disabled={connecting()}
              onPress={() => void connect()}
            />
            <Note>
              On another device, use your server’s network address or the web
              origin that proxies the API. Localhost always means this device.
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
  const page = signal("Stock");
  const pages = ["Stock", "Shopping", "Meals", "Chores"];
  return (
    <View class="flex-1 md:flex-row">
      <View class="hidden md:flex md:flex-col w-[200px] shrink-0 bg-white border-r border-[#e4e4e0] px-4 py-7 gap-8">
        <Text class="text-lg font-semibold px-2 text-[#1b1d1c]">
          Grocy Next
        </Text>
        <View class="gap-1">
          <Each of={pages}>
            {(name) => (
              <Nav
                label={name()}
                selected={page() === name()}
                onPress={() => page.set(name())}
              />
            )}
          </Each>
        </View>
        <View class="flex-1" />
        <Nav
          label="Settings"
          selected={page() === "Settings"}
          onPress={() => page.set("Settings")}
        />
      </View>
      <View class="flex-1 min-w-0 min-h-0">
        <View class="md:hidden flex-row items-center justify-between px-4 py-2 border-b border-[#e4e4e0] bg-white">
          <Text class="text-base font-semibold text-[#1b1d1c]">Grocy Next</Text>
          <Action label="Settings" quiet onPress={() => page.set("Settings")} />
        </View>
        <Each of={[page()]}>
          {(current) => (
            <Scroll class="flex-1">
              <View class="w-full max-w-[1024px] self-center p-4 md:p-8 gap-5">
                {page() === "Stock" ? <Stock api={p.api} /> : null}
                {page() === "Shopping" ? <Shopping api={p.api} /> : null}
                {page() === "Meals" ? <Meals api={p.api} /> : null}
                {page() === "Chores" ? <Household api={p.api} /> : null}
                {page() === "Settings" ? (
                  <View class="gap-5">
                    <View class="flex-row justify-between items-center">
                      <Heading title="Settings" />
                      <Action
                        label="Disconnect"
                        quiet
                        onPress={p.onDisconnect}
                      />
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
                <Nav
                  label={name()}
                  selected={page() === name()}
                  onPress={() => page.set(name())}
                />
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
      selected={p.selected}
      onPress={p.onPress}
      class="min-h-14 md:min-h-11 px-3 justify-center rounded-lg hover:bg-[#f0f0ec] focus:outline-2 focus:outline-[#22603f]"
      style={{ backgroundColor: p.selected ? "#edf2ee" : "transparent" }}
    >
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
