import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { openApiDocument } from "@/lib/open-document";
import { batteriesQuery, choresQuery, productsQuery, recipesQuery } from "@/hooks/queries";

export const Route = createFileRoute("/labels")({
  component: LabelsPage,
});

type LabelTab = "products" | "recipes" | "chores" | "batteries" | "shopping";

function LabelsPage() {
  const [tab, setTab] = useState<LabelTab>("products");
  const [busy, setBusy] = useState<string | null>(null);
  const products = useQuery(productsQuery());
  const recipes = useQuery(recipesQuery());
  const chores = useQuery(choresQuery());
  const batteries = useQuery(batteriesQuery());

  const open = async (key: string, path: string) => {
    setBusy(key);

    try {
      await openApiDocument(path);
    } finally {
      setBusy(null);
    }
  };

  const error = products.error || recipes.error || chores.error || batteries.error;

  return (
    <>
      <PageHeader
        title="Labels & printouts"
        lead="Open Grocy label and list layouts in a new tab. Your API key is sent with each request."
      />
      <Tabs
        ariaLabel="Label types"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "products", label: "Products" },
          { id: "recipes", label: "Recipes" },
          { id: "chores", label: "Chores" },
          { id: "batteries", label: "Batteries" },
          { id: "shopping", label: "Shopping" },
        ]}
      />
      {error ? (
        <ErrorBlock message={error instanceof Error ? error.message : "Could not load data."} />
      ) : null}
      <TabPanel id="panel-products" labelledBy="tab-products" hidden={tab !== "products"}>
        {products.isLoading ? <LoadingBlock label="Loading products…" /> : null}
        <ul className="product-list">
          {(products.data ?? []).map((product) => (
            <li className="product-row management-row" key={product.id}>
              <span>{product.name}</span>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy === `p-${product.id}`}
                  onClick={() =>
                    open(`p-${product.id}`, `/api/stock/products/${product.id}/printlabel`)
                  }
                >
                  Stock label
                </button>
              </div>
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-recipes" labelledBy="tab-recipes" hidden={tab !== "recipes"}>
        {recipes.isLoading ? <LoadingBlock label="Loading recipes…" /> : null}
        <ul className="product-list">
          {(recipes.data ?? []).map((recipe) => (
            <li className="product-row management-row" key={recipe.id}>
              <span>{recipe.name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy === `r-${recipe.id}`}
                onClick={() => open(`r-${recipe.id}`, `/api/recipes/${recipe.id}/printlabel`)}
              >
                Recipe label
              </button>
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-chores" labelledBy="tab-chores" hidden={tab !== "chores"}>
        {chores.isLoading ? <LoadingBlock label="Loading chores…" /> : null}
        <ul className="product-list">
          {(chores.data ?? []).map((chore) => (
            <li className="product-row management-row" key={chore.id}>
              <span>{chore.chore_name ?? chore.name ?? `Chore ${chore.id}`}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy === `c-${chore.id}`}
                onClick={() => open(`c-${chore.id}`, `/api/chores/${chore.id}/printlabel`)}
              >
                Chore label
              </button>
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-batteries" labelledBy="tab-batteries" hidden={tab !== "batteries"}>
        {batteries.isLoading ? <LoadingBlock label="Loading batteries…" /> : null}
        <ul className="product-list">
          {(batteries.data ?? []).map((battery) => (
            <li className="product-row management-row" key={battery.id}>
              <span>{battery.battery?.name ?? battery.name ?? `Battery ${battery.id}`}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy === `b-${battery.id}`}
                onClick={() => open(`b-${battery.id}`, `/api/batteries/${battery.id}/printlabel`)}
              >
                Battery label
              </button>
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-shopping" labelledBy="tab-shopping" hidden={tab !== "shopping"}>
        <div className="panel panel-inner">
          <p className="page-lead">Thermal shopping list layout for receipt printers.</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === "shopping-thermal"}
            onClick={() => open("shopping-thermal", "/api/print/shoppinglist/thermal")}
          >
            Open thermal list
          </button>
        </div>
      </TabPanel>
    </>
  );
}
