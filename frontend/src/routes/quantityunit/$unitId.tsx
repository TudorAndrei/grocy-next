import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { QuantityUnitEditor } from "@/components/QuantityUnitEditor";
import { quantityUnitSearch } from "@/lib/quantity-unit-form";
import { useNativeDocumentReload } from "@/lib/native-document";
import { nativeQueryParameter } from "@/lib/native-query-flag";

export const Route = createFileRoute("/quantityunit/$unitId")({
  validateSearch: quantityUnitSearch,
  component: UnitRoute,
});

function UnitRoute() {
  const { unitId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [version, setVersion] = useState(0);
  const reloadDocument = useNativeDocumentReload(/^\/quantityunit\/[^/]+$/);

  return (
    <QuantityUnitEditor
      key={`${unitId}:${version}`}
      recordId={unitId === "new" ? null : Number(unitId)}
      onSaved={async (id, mode) => {
        if (nativeQueryParameter(router.history.location.search, "embedded") !== undefined)
          window.parent.postMessage({ Message: "Reload", Payload: null }, window.location.origin);
        else if (mode === "stay") return;
        else if (mode === "continue") {
          if (unitId !== "new") {
            if (!reloadDocument()) setVersion((value) => value + 1);

            return;
          }

          await navigate({
            to: "/quantityunit/$unitId",
            params: { unitId: String(id) },
            search: {},
          });
        } else await navigate({ to: "/quantityunits", search: {} });
      }}
    />
  );
}
