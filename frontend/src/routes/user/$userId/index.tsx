import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserEditor } from "@/components/UserEditor";

export const Route = createFileRoute("/user/$userId/")({ component: Page });

function Page() {
  const { userId } = Route.useParams();

  return <UserDocument key={userId} userId={userId} />;
}

function UserDocument({ userId }: { userId: string }) {
  const router = useRouter();
  const [search] = useState(router.history.location.search);
  const navigate = Route.useNavigate();

  return (
    <UserEditor
      recordId={userId === "new" ? null : userId}
      search={search}
      onSaved={async (signal) => {
        if (signal.aborted) return;
        await navigate({ href: "/users" });
      }}
    />
  );
}
