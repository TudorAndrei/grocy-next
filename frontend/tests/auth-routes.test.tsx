import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { api, queryKeys } from "@/lib/api";
import { configStorageKeys, readApiConfig } from "@/lib/config";

function mount(
  path: string,
  authenticated = false,
  revokeStatus = 204,
  basepath = "/",
  nativeUrls?: { login_url: string; logout_url: string },
  identityFailure: "unauthorized" | "redirect" | "opaque" = "unauthorized",
  keyLifecycle?: { selected: string; bootstrap: string },
) {
  const prefix = basepath === "/" ? "" : basepath;
  vi.stubEnv("BASE_URL", `${prefix}/`);
  vi.stubEnv("VITE_API_BASE", "");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  localStorage.setItem(
    configStorageKeys().key,
    keyLifecycle?.selected ?? (authenticated ? "old-session" : "expired-session"),
  );
  vi.stubGlobal("scrollTo", vi.fn());
  let activeKey = authenticated ? "old-session" : "";
  let cookieSession = authenticated;
  let logoutStatus = revokeStatus;
  const validKeys = new Set(keyLifecycle ? [keyLifecycle.selected, keyLifecycle.bootstrap] : []);
  const revokedKeys: Array<string | null> = [];
  const pendingRefresh: Array<{ path: string; release: () => void }> = [];
  let refreshHeld = false;

  const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
    const url = String(input).slice(prefix.length);
    const key = new Headers(options?.headers).get("GROCY-API-KEY");

    if (refreshHeld && (url === "/api/v2/setup" || url === "/api/user")) {
      await new Promise<void>((release) => pendingRefresh.push({ path: url, release }));
    }

    if (url === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (url === "/api/v2/user/permissions") return Response.json({});

    if (url === "/api/v2/system/login-context")
      return Response.json({
        ...(nativeUrls ?? { login_url: `${prefix}/login`, logout_url: `${prefix}/logout` }),
        browser_session_supplied: false,
      });

    if (url === "/api/v2/login") {
      activeKey = "new-session";
      cookieSession = true;

      return Response.json({ user_id: 1, username: "owner", api_key: activeKey });
    }

    if (url === "/api/v2/logout") {
      if (keyLifecycle) {
        revokedKeys.push(key);

        if (key !== null) validKeys.delete(key);
        refreshHeld = revokedKeys.length === 1;

        return new Response(null, { status: logoutStatus });
      }

      if (logoutStatus === 204) {
        activeKey = "";
        cookieSession = false;
      }

      return new Response(null, { status: logoutStatus });
    }

    if (url === "/api/user") {
      if (keyLifecycle) {
        return key !== null && validKeys.has(key)
          ? Response.json([
              {
                id: key === keyLifecycle.bootstrap ? 1 : 2,
                username: key === keyLifecycle.bootstrap ? "bootstrap" : "control",
              },
            ])
          : Response.json({ error_message: "Unauthorized" }, { status: 401 });
      }

      if (cookieSession || (activeKey && key === activeKey))
        return Response.json([{ id: 1, username: "owner" }]);

      if (identityFailure === "redirect")
        return new Response(null, { status: 302, headers: { Location: `${prefix}/login` } });

      if (identityFailure === "opaque") {
        const response = new Response(null);

        Object.defineProperties(response, {
          type: { value: "opaqueredirect" },
          status: { value: 0 },
        });

        return response;
      }

      return Response.json({ error_message: "Unauthorized" }, { status: 401 });
    }

    if (url === "/api/system/config")
      return Response.json({
        ENTRY_PAGE: "tasks",
        BASE_URL: prefix || "/",
        DISABLE_URL_REWRITING: false,
        FEATURE_FLAG_STOCK: false,
        FEATURE_FLAG_SHOPPINGLIST: false,
      });

    if (url === "/api/user/settings") return Response.json({});

    if (url === "/api/v2/tasks/overview")
      return Response.json({ rows: [], categories: [], next_days: 5, include_done: false });

    if (url.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const history = createMemoryHistory({ initialEntries: [`${prefix}${path}`] });
  const router = createAppRouter({ basepath, history });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return {
    router,
    history,
    client,
    fetchMock,
    revokedKeys,
    pendingRefresh,
    releaseRefresh: () => {
      refreshHeld = false;
      pendingRefresh.forEach((reply) => reply.release());
    },
    allowLogout: () => {
      logoutStatus = 204;
    },
  };
}

test.each([
  [false, "/"],
  [true, "/"],
  [false, "/grocy"],
] as const)(
  "native login submits an ordinary form with cookie credentials (authenticated=%s, base=%s)",
  async (authenticated, basepath) => {
    const { fetchMock } = mount(
      "/login?returnto=https%3A%2F%2Foutside.example%2Fsecret",
      authenticated,
      204,
      basepath,
    );

    const user = userEvent.setup();
    const username = await screen.findByLabelText<HTMLInputElement>("Username");
    const password = screen.getByLabelText<HTMLInputElement>("Password");
    await user.type(username, " owner ");
    const form = username.form!;
    expect(form.method).toBe("post");
    expect(new URL(form.action).pathname).toBe(`${basepath === "/" ? "" : basepath}/login`);
    expect(new URL(form.action).search).toBe("");
    expect(form.noValidate).toBe(true);
    expect(password.value).toBe("");
    expect(Array.from(new FormData(form))).toEqual([
      ["username", " owner "],
      ["password", ""],
    ]);
    await user.click(screen.getByLabelText("Stay logged in permanently"));
    expect(new FormData(form).get("stay_logged_in")).toBe("on");
    expect(screen.getByRole("button", { name: "OK" })).toBeTruthy();
    // dispatchEvent exposes whether production cancels the browser's real form submission.
    expect(fireEvent.submit(form)).toBe(true);
    expect(readApiConfig().apiKey).toBe("");
    await api.getCurrentUser().catch(() => undefined);

    const request = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith("/api/user"))
      .at(-1)!;

    expect(new Headers(request[1]?.headers).has("GROCY-API-KEY")).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/login"))).toBe(
      false,
    );
  },
);

test.each([
  ["invalid=true", true],
  ["invalid=1", false],
  ["invalid=true&invalid=false", true],
  ["invalid=false&invalid=true", false],
  ["invalid&invalid=true", false],
  ["inval%69d=true", false],
  ["invalid=%E0%A4%A", false],
])("direct login uses the first raw invalid parameter (%s)", async (query, visible) => {
  mount(`/login?${query}`, true);
  await screen.findByLabelText("Username");
  expect(Boolean(screen.queryByText("Invalid credentials, please try again"))).toBe(visible);
});

test("native login consumes the public canonical action independently of the current route", async () => {
  mount("/login", true, 204, "/", {
    login_url: "https://home.example/house/index.php/login",
    logout_url: "https://home.example/house/index.php/logout",
  });
  const form = (await screen.findByLabelText<HTMLInputElement>("Username")).form!;
  expect(form.action).toBe("https://home.example/house/index.php/login");
});

test("the additional account login still issues a key and leaves cookie-only selection", async () => {
  const app = mount("/login");
  const native = (await screen.findByLabelText<HTMLInputElement>("Username")).form!;
  fireEvent.submit(native);
  await act(async () => app.router.navigate({ to: "/catalog" }));
  await userEvent.type(await screen.findByLabelText("Username"), " owner ");
  await userEvent.type(screen.getByLabelText("Password"), "secret");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Feature disabled" });
  expect(readApiConfig().apiKey).toBe("new-session");
  expect(localStorage.getItem(configStorageKeys().key)).toBe("new-session");

  const login = app.fetchMock.mock.calls.find(([input]) =>
    String(input).endsWith("/api/v2/login"),
  )!;

  expect(JSON.parse(String(login[1]?.body))).toEqual({ username: "owner", password: "secret" });
});

test("native cookie signout follows an ordinary server link without revoking a saved API key", async () => {
  const app = mount("/login", true, 204, "/grocy");
  fireEvent.submit((await screen.findByLabelText<HTMLInputElement>("Username")).form!);
  await act(async () => app.router.navigate({ to: "/tasks" }));
  await screen.findByRole("heading", { name: "Tasks" });
  await userEvent.setup().click(screen.getByRole("button", { name: "User: owner" }));
  expect(screen.getByRole("link", { name: "Change password" }).getAttribute("href")).toBe(
    "/grocy/user/1?changepw=true",
  );
  const link = screen.getByRole("link", { name: "Logout" });
  expect(link.getAttribute("href")).toBe("/grocy/logout");
  let intercepted = true;

  const stopNavigation = (event: MouseEvent) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  };

  document.addEventListener("click", stopNavigation);
  onTestFinished(() => document.removeEventListener("click", stopNavigation));
  fireEvent.click(link, { button: 0 });
  expect(intercepted).toBe(false);
  expect(localStorage.getItem(configStorageKeys().key)).toBe("old-session");
  expect(app.fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/logout"))).toBe(
    false,
  );
});

test.each(["/", "/grocy"])(
  "additional key signout clears the browser session and returns to root under %s",
  async (basepath) => {
    const { router, history, client, fetchMock } = mount(
      "/signout?returnto=%2Ftasks",
      true,
      204,
      basepath,
    );

    await screen.findByLabelText("Username");
    await waitFor(() => expect(router.state.location.pathname).toBe("/signin"), { timeout: 5000 });
    expect(history.location.pathname).toBe(basepath === "/" ? "/signin" : "/grocy/signin");
    expect(router.state.location.search).toEqual({});
    expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
    expect(client.getQueryData(queryKeys.currentUser)).toBeUndefined();

    const logout = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/v2/logout"),
    );

    expect(logout).toHaveLength(1);
    expect(logout[0]?.[1]?.method).toBe("POST");
    expect(new Headers(logout[0]?.[1]?.headers).get("GROCY-API-KEY")).toBe("old-session");
  },
);

test.each(["/signout", "/tasks"])(
  "failed logout from %s retains the cookie session and allows retry",
  async (path) => {
    const { router, client, fetchMock, allowLogout } = mount(path, true, 503);
    const user = userEvent.setup();

    if (path === "/tasks") {
      await screen.findByRole("heading", { name: "Tasks" });
      await user.click(screen.getByRole("link", { name: "Sign out" }));
    }

    await screen.findByRole("alert");
    expect(router.state.location.pathname).toBe("/signout");
    expect(localStorage.getItem(configStorageKeys().key)).toBe("old-session");
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.currentUser)).toEqual({ id: 1, username: "owner" }),
    );
    allowLogout();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Username");
    await waitFor(() => expect(router.state.location.pathname).toBe("/signin"));
    expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
    expect(client.getQueryData(queryKeys.currentUser)).toBeUndefined();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/v2/logout"),
    ).toHaveLength(2);
  },
);

test("logout invalidates cached private data from the previous signed-in page", async () => {
  const { router, client } = mount("/tasks", true);
  await screen.findByRole("heading", { name: "Tasks" });
  await screen.findByText("No open tasks.");
  expect(client.getQueryData(queryKeys.tasks)).toEqual([]);
  await waitFor(() =>
    expect(client.getQueryData(queryKeys.currentUser)).toEqual({ id: 1, username: "owner" }),
  );
  await act(async () => {
    await router.navigate({ to: "/signout" });
  });
  await screen.findByLabelText("Username");
  expect(client.getQueryData(queryKeys.currentUser)).toBeUndefined();
  expect(client.getQueryData(queryKeys.tasks)).toBeUndefined();
  expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull();
});

test("logout with an expired session clears the stale key and returns to root", async () => {
  const { router } = mount("/signout", false, 401);
  await screen.findByLabelText("Username");
  await waitFor(() => expect(router.state.location.pathname).toBe("/signin"));
  expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["redirect", "opaque"] as const)(
  "native protected pages turn a %s identity result into the native login route",
  async (failure) => {
    const app = mount("/tasks", false, 204, "/grocy", undefined, failure);
    await screen.findByLabelText("Stay logged in permanently");
    expect(app.history.location.pathname).toBe("/grocy/login");
    expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull();
    const identity = app.fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/user"))!;
    expect(identity[1]?.redirect).toBe("manual");
  },
);

test.each(["/grocy", "/grocy/index.php"])(
  "native identity failure reaches its canonical script login with base %s",
  async (basepath) => {
    const app = mount(
      "/tasks",
      false,
      204,
      basepath,
      { login_url: "/grocy/index.php/login", logout_url: "/grocy/index.php/logout" },
      "redirect",
    );

    const username = await screen.findByLabelText<HTMLInputElement>("Username");

    expect(app.history.location.pathname).toBe("/grocy/index.php/login");
    expect(new URL(username.form!.action).pathname).toBe("/grocy/index.php/login");
    expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull();
  },
);

test("one natural sign-out revokes only its selected key across a held session refresh", async () => {
  const app = mount("/tasks", true, 204, "/", undefined, "unauthorized", {
    selected: "disposable-control",
    bootstrap: "dev-key",
  });

  await screen.findByRole("heading", { name: "Tasks" });
  expect(app.client.getQueryData(queryKeys.currentUser)).toMatchObject({
    id: 2,
    username: "control",
  });
  await userEvent.setup().click(screen.getByRole("link", { name: "Sign out" }));
  await waitFor(() =>
    expect(app.pendingRefresh.some((reply) => reply.path === "/api/v2/setup")).toBe(true),
  );
  expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
  await act(async () => app.releaseRefresh());
  await screen.findByLabelText("Username");
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/signin"));

  // Exercise the still-valid ambient key after the complete transition, so an old
  // remounted LogoutPage gets far enough to send and revoke its second key.
  const bootstrap = await api
    .getCurrentUser()
    .catch((error: { status: number }) => ({ status: error.status }));

  const posts = app.fetchMock.mock.calls.filter(
    ([input, options]) => String(input) === "/api/v2/logout" && options?.method === "POST",
  );

  expect(posts.map(([, options]) => new Headers(options?.headers).get("GROCY-API-KEY"))).toEqual([
    "disposable-control",
  ]);
  expect(app.revokedKeys).toEqual(["disposable-control"]);
  expect(bootstrap).toMatchObject({ id: 1, username: "bootstrap" });
  expect(localStorage.getItem(configStorageKeys().key)).toBeNull();
});
