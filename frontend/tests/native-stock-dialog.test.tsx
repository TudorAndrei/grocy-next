import { StrictMode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { NativeStockPageDialog } from "@/components/NativeStockPageDialog";

test.each(["stockentries", "stockjournal"] as const)(
  "a nested %s document opens once in the highest Grocy host under Strict Mode",
  async (kind) => {
    const current = window;
    const external = { postMessage: vi.fn() };
    Object.defineProperty(external, "parent", { value: external });
    const host = { IsGrocy: true, parent: external, postMessage: vi.fn() };
    const parent = { IsGrocy: true, parent: host, postMessage: vi.fn() };
    vi.stubGlobal("parent", parent);
    vi.stubGlobal("top", external);

    const onClose = vi.fn();

    const root = createRootRoute({
      component: () => <NativeStockPageDialog kind={kind} productId={7} onClose={onClose} />,
    });

    const router = createRouter({
      routeTree: root,
      basepath: "/house.hold/index.php/",
      history: createMemoryHistory({ initialEntries: ["/house.hold/index.php/"] }),
    });

    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    await waitFor(() => expect(host.postMessage).toHaveBeenCalledTimes(1));
    expect(host.postMessage).toHaveBeenCalledWith(
      {
        Message: "IframeModal",
        Payload: {
          Link: `${current.location.origin}/house.hold/index.php/${kind}?embedded&product=7`,
          DialogType: "table",
        },
      },
      current.location.origin,
    );
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(external.postMessage).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);
