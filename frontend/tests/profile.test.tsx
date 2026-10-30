import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AccessManager } from "@/components/AccessManager";
import { OwnProfile } from "@/components/OwnProfile";

const profile = {
  id: 8,
  username: "cook",
  first_name: "Sam",
  last_name: "Green",
  picture_file_name: "saved.png",
};

function mount(component: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {component}
    </QueryClientProvider>,
  );
}

test("own profile edits keep the photo with only self-edit access", async () => {
  const saved: Record<string, string | null>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/api/user") return Response.json([profile]);

      if (String(input) === "/api/users/8" && init?.method === "PUT") {
        saved.push(JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      return Response.json({ error_message: "Permission denied" }, { status: 403 });
    }),
  );
  mount(<OwnProfile />);
  const user = userEvent.setup();
  const first = await screen.findByLabelText("First name");
  await user.clear(first);
  await user.type(first, "Alex");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved.");
  expect(saved[0]).toEqual({
    username: "cook",
    first_name: "Alex",
    last_name: "Green",
    picture_file_name: "saved.png",
    password: "",
  });
});

test("a photo upload can retry a failed profile save without a second upload", async () => {
  const uploads: string[] = [];
  const writes: Record<string, string | null>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/user") return Response.json([profile]);

      if (path.startsWith("/api/files/userpictures/") && init?.method === "PUT") {
        uploads.push(path);

        return new Response(null, { status: 204 });
      }

      if (path === "/api/users/8" && init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));

        return writes.length === 1
          ? Response.json({ error_message: "Save failed" }, { status: 400 })
          : new Response(null, { status: 204 });
      }

      return Response.json({ error_message: "Permission denied" }, { status: 403 });
    }),
  );
  mount(<OwnProfile />);
  const user = userEvent.setup();
  const photo = await screen.findByLabelText("Profile photo");
  await user.upload(photo, new File(["image"], "portrait.png", { type: "image/png" }));
  await user.type(screen.getByLabelText("New password"), "new-secret");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Save failed");
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved.");
  expect(uploads).toHaveLength(1);
  expect(writes).toHaveLength(2);
  expect(writes[0]?.picture_file_name).toMatch(/-portrait.png$/);
  expect(writes[1]).toEqual(writes[0]);
  await waitFor(() => expect(screen.getByLabelText("New password").getAttribute("value")).toBe(""));
});

test("an administrator name edit preserves the selected user's picture", async () => {
  const saved: Record<string, string | null>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/users") return Response.json([profile]);

      if (path === "/api/users/8" && init?.method === "PUT") {
        saved.push(JSON.parse(String(init.body)));

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  mount(<AccessManager />);
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "cook" });
  await user.selectOptions(screen.getByLabelText("User"), "8");
  await user.type(screen.getByLabelText("First name"), "uel");
  await user.click(screen.getByRole("button", { name: "Save user" }));
  await waitFor(() => expect(saved[0]?.first_name).toBe("Samuel"));
  expect(saved[0]?.picture_file_name).toBe("saved.png");
});
