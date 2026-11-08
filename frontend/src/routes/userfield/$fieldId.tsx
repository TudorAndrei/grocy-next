import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserfieldEditor } from "@/components/UserfieldEditor";
import { userfieldFormSearch } from "@/lib/userfield-form";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/userfield/$fieldId")({
  validateSearch: userfieldFormSearch,
  component: Page,
});

function Page() {
  const { fieldId } = Route.useParams();

  return <DefinitionDocument key={fieldId} fieldId={fieldId} />;
}

function DefinitionDocument({ fieldId }: { fieldId: string }) {
  const router = useRouter();
  const [entity] = useState(() => nativeQueryParameter(router.history.location.search, "entity"));
  const navigate = Route.useNavigate();

  return (
    <UserfieldEditor
      recordId={fieldId === "new" ? null : Number(fieldId)}
      entity={entity}
      onSaved={async ({ signal, redirectEntity }) => {
        if (signal.aborted) return;

        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else
          await navigate({
            href: redirectEntity ? `/userfields?entity=${redirectEntity}` : "/userfields",
          });
      }}
    />
  );
}
