import { useI18n } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { openApiDocument } from "@/lib/open-document";
import { batteriesQuery, choresQuery, productsQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { api, queryKeys } from "@/lib/api";
import { GrocycodeActions } from "@/components/GrocycodeActions";

export const Route = createFileRoute("/labels")({
  component: LabelsPage,
});

type LabelTab = "products" | "recipes" | "chores" | "batteries" | "shopping";

function LabelsPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();

  const tabs: Array<{ id: LabelTab; label: string }> = [
    { id: "products", label: tr("Products") },
    { id: "recipes", label: tr("Recipes") },
    { id: "chores", label: tr("Chores") },
    { id: "batteries", label: tr("Batteries") },
    { id: "shopping", label: tr("Shopping") },
  ];

  const enabledTabs = tabs.filter((item) => features.routeEnabled(`/${item.id}`));
  const [selection, setTab] = useState<LabelTab>("products");
  const tab = enabledTabs.some((item) => item.id === selection) ? selection : enabledTabs[0]?.id;
  const products = useQuery({ ...productsQuery(), enabled: features.enabled("STOCK") });

  const recipes = useQuery({
    queryKey: queryKeys.recipeOverview,
    queryFn: api.getRecipeOverview,
    enabled: features.enabled("RECIPES"),
  });

  const chores = useQuery({ ...choresQuery(), enabled: features.enabled("CHORES") });
  const batteries = useQuery({ ...batteriesQuery(), enabled: features.enabled("BATTERIES") });

  const thermal = useMutation({
    mutationFn: () => openApiDocument("/api/print/shoppinglist/thermal"),
  });

  const error = products.error || recipes.error || chores.error || batteries.error || thermal.error;

  return (
    <>
      <PageHeader
        title={tr("Labels & printouts")}
        lead={tr("Download codes or send labels to the configured printer.")}
      />
      <Tabs ariaLabel={tr("Label types")} value={tab ?? ""} onChange={setTab} tabs={enabledTabs} />
      {error ? (
        <ErrorBlock message={error instanceof Error ? error.message : tr("Could not load data.")} />
      ) : null}
      <TabPanel id="panel-products" labelledBy="tab-products" hidden={tab !== "products"}>
        {products.isLoading ? <LoadingBlock label={tr("Loading products…")} /> : null}
        <ul className="product-list">
          {(products.data ?? []).map((product) => (
            <li className="product-row management-row" key={product.id}>
              <span>{product.name}</span>
              <GrocycodeActions kind="product" id={product.id} name={product.name} />
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-recipes" labelledBy="tab-recipes" hidden={tab !== "recipes"}>
        {recipes.isLoading ? <LoadingBlock label={tr("Loading recipes…")} /> : null}
        <ul className="product-list">
          {(recipes.data ?? []).map((recipe) => (
            <li className="product-row management-row" key={recipe.id}>
              <span>{recipe.name}</span>
              <GrocycodeActions kind="recipe" id={recipe.id} name={recipe.name} />
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-chores" labelledBy="tab-chores" hidden={tab !== "chores"}>
        {chores.isLoading ? <LoadingBlock label={tr("Loading chores…")} /> : null}
        <ul className="product-list">
          {(chores.data ?? []).map((chore) => (
            <li className="product-row management-row" key={chore.id}>
              <span>{chore.chore_name ?? chore.name ?? tr("Chore %s", String(chore.id))}</span>
              <GrocycodeActions
                kind="chore"
                id={chore.id}
                name={chore.chore_name ?? chore.name ?? tr("Chore %s", String(chore.id))}
              />
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-batteries" labelledBy="tab-batteries" hidden={tab !== "batteries"}>
        {batteries.isLoading ? <LoadingBlock label={tr("Loading batteries…")} /> : null}
        <ul className="product-list">
          {(batteries.data ?? []).map((battery) => (
            <li className="product-row management-row" key={battery.id}>
              <span>
                {battery.battery?.name ?? battery.name ?? tr("Battery %s", String(battery.id))}
              </span>
              <GrocycodeActions
                kind="battery"
                id={battery.id}
                name={battery.battery?.name ?? battery.name ?? tr("Battery %s", String(battery.id))}
              />
            </li>
          ))}
        </ul>
      </TabPanel>
      <TabPanel id="panel-shopping" labelledBy="tab-shopping" hidden={tab !== "shopping"}>
        <div className="panel panel-inner">
          <p className="page-lead">{tr("Thermal shopping list layout for receipt printers.")}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={thermal.isPending}
            onClick={() => thermal.mutate()}
          >
            {tr("Open thermal list")}
          </button>
        </div>
      </TabPanel>
    </>
  );
}
