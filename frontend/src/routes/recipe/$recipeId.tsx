import { useState } from "react";
import {
  createFileRoute,
  Outlet,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { RecipeEditor } from "@/components/RecipeEditor";
import { recipeFormSearch } from "@/lib/recipe-form";
import { useNativeDocumentReload } from "@/lib/native-document";

export const Route = createFileRoute("/recipe/$recipeId")({
  validateSearch: recipeFormSearch,
  component: Page,
});

function Page() {
  const { recipeId } = Route.useParams();
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });
  const leaf = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  const navigate = Route.useNavigate();
  const [version, setVersion] = useState(0);
  const reloadDocument = useNativeDocumentReload(/^\/recipe\/[^/]+$/);

  if (leaf !== Route.id) return <Outlet />;

  return (
    <RecipeEditor
      key={`${recipeId}:${version}`}
      recordId={recipeId === "new" ? null : Number(recipeId)}
      search={search}
      onSaved={async (id, location) => {
        if (location === "return") await navigate({ href: `/recipes?recipe=${id}` });
        else {
          const replacing = String(id) === recipeId && reloadDocument();
          await navigate({ to: "/recipe/$recipeId", params: { recipeId: String(id) }, search: {} });

          if (!replacing) setVersion((value) => value + 1);
        }
      }}
    />
  );
}
