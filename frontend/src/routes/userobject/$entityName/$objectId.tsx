import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserobjectEditor } from "@/components/UserobjectEditor";
import { customObjectSearch } from "@/lib/custom-object-form";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/userobject/$entityName/$objectId")({
  validateSearch: customObjectSearch,
  component: UserobjectRoute,
});

function UserobjectRoute() {
  const { entityName, objectId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  return (
    <UserobjectEditor
      key={`${entityName}:${objectId}`}
      entityName={entityName}
      recordId={objectId === "new" ? null : Number(objectId)}
      onSaved={async () => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else await navigate({ to: "/userobjects/$entityName", params: { entityName }, search: {} });
      }}
    />
  );
}
