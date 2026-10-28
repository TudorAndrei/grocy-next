import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { EquipmentManual } from "@/components/EquipmentManual";

test("the manual uses authenticated PDF data and releases replaced and closed documents", async () => {
  const pending: Array<{
    name: string;
    resolve: (response: Response) => void;
    signal?: AbortSignal | null;
  }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("dev-key");

      return new Promise<Response>((resolve) =>
        pending.push({ name: String(input), resolve, signal: init?.signal }),
      );
    }),
  );
  const documents: Blob[] = [];
  const revoked: string[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        documents.push(blob);

        return `blob:manual-${documents.length}`;
      }
      static revokeObjectURL(url: string) {
        revoked.push(url);
      }
    },
  );

  const view = render(
    <StrictMode>
      <EquipmentManual name="first.pdf" label="Mixer manual" />
    </StrictMode>,
  );

  await act(async () => {
    for (const request of pending)
      request.resolve(new Response("%PDF-first", { headers: { "Content-Type": "text/html" } }));
  });
  const manual = await screen.findByLabelText<HTMLObjectElement>("Mixer manual");
  expect(pending[0]?.name).toBe("/api/files/equipmentmanuals/Zmlyc3QucGRm");
  expect(manual.data).toBe("blob:manual-1");
  expect(manual.type).toBe("application/pdf");
  expect(documents).toHaveLength(1);
  expect(documents[0]?.type).toBe("application/pdf");
  view.rerender(
    <StrictMode>
      <EquipmentManual name="second.pdf" label="Mixer manual" />
    </StrictMode>,
  );
  expect(revoked).toEqual(["blob:manual-1"]);
  expect(pending[1]?.signal?.aborted).toBe(true);
  await act(async () => pending.at(-1)!.resolve(new Response("%PDF-second")));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLObjectElement>("Mixer manual").data).toBe("blob:manual-2"),
  );
  view.unmount();
  expect(revoked).toEqual(["blob:manual-1", "blob:manual-2"]);
});
