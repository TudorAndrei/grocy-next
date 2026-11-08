import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserentityEditor } from "@/components/UserentityEditor";
import { customObjectSearch } from "@/lib/custom-object-form";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/userentity/$entityId")({
  validateSearch: customObjectSearch,
  component: UserentityRoute,
});

function UserentityRoute() {
  const { entityId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <UserentityEditor
      key={entityId}
      recordId={entityId === "new" ? null : Number(entityId)}
      onSaved={async (signal) => {
        if (signal.aborted) return;

        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/userentities", search: {} });
      }}
    />
  );
}
