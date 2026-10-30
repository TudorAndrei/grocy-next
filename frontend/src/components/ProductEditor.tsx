import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { EntityManager } from "./EntityManager";
import { ProductRelatedData } from "./ProductRelatedData";
import { ProductJournal } from "./StockJournal";
import { ProductEntries } from "./StockEntries";

export function ProductEditor(
  props: Omit<ComponentProps<typeof EntityManager>, "entity" | "related">,
) {
  return (
    <EntityManager
      {...props}
      entity="products"
      related={ProductRelatedData}
      editorActions={(row, pending) => (
        <>
          {props.editorActions?.(row, pending)}
          <ProductEntries productId={row.id} name={row.name ?? ""} disabled={pending} />
          <ProductJournal productId={row.id} name={row.name ?? ""} disabled={pending} />
        </>
      )}
      actions={(row) => (
        <>
          {props.actions?.(row)}
          <CopyProductLink id={row.id} name={row.name ?? `#${row.id}`} />
        </>
      )}
    />
  );
}

export function CopyProductLink({ id, name }: { id: number; name: string }) {
  const { t } = useI18n();

  return (
    <Link
      className="btn btn-ghost btn-sm"
      to="/product/$productId"
      params={{ productId: "new" }}
      search={{ "copy-of": id }}
      aria-label={`${t("Copy")} ${name}`}
    >
      {t("Copy")}
    </Link>
  );
}
