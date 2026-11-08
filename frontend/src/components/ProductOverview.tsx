import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import type { ProductCardMemory } from "@/lib/product-card-memory";
import { useProductCardMemory } from "@/hooks/useProductCardMemory";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useDialogState } from "@/hooks/useDialogState";
import { ProductEntries } from "./StockEntries";
import { ProductJournal } from "./StockJournal";
import { ShoppingItemForm } from "./ShoppingItemForm";
import { StockTableDate } from "./StockTableDate";
import { RichText } from "./RichDescription";
import { EntityPicture } from "./EntityPicture";
import { ProductPriceHistory } from "./ProductPriceHistory";
import { ProductEditor } from "./ProductEditor";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

type CardProps = {
  productId: number;
  memory?: ProductCardMemory;
  embedded: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onReturn: () => Promise<void>;
  onClose?: () => void;
};

export function ProductOverview(props: CardProps & { onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog product-overview-dialog"
      aria-label={t("Product overview")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <ProductCard
        {...props}
        onClose={() => {
          if (dialog.current?.open) props.onClose();
        }}
      />
    </dialog>
  );
}

export function ProductCard({
  productId,
  memory: externalMemory,
  embedded,
  expanded,
  onExpandedChange,
  onReturn,
  onClose,
}: CardProps) {
  const { t, pluralIndex, ready, locale } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const settings = useQuery(userSettingsQuery());
  const memory = useProductCardMemory({ external: externalMemory });
  const snapshot = useSyncExternalStore(memory.subscribe, memory.getSnapshot);
  const returnto = useLocation({ select: (location) => location.href });
  const close = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const focusAfterRead = useRef(false);
  const title = useId();
  const descriptionId = useId();
  const shopping = useDialogState<true>();

  const closeShopping = () => {
    if (shopping.state) shopping.close(shopping.state.id);
  };

  const [editing, setEditing] = useState(false);

  const data = useQuery({
    queryKey: ["product-overview", productId, memory.id],
    queryFn: ({ signal }) => {
      // Release query bookkeeping on close; the page still owns the native callback.
      signal.throwIfAborted();

      return memory.read(productId);
    },
    enabled: ready && features.query.isSuccess && settings.isSuccess,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (data.isFetching || !focusAfterRead.current) return;
    focusAfterRead.current = false;
    ((data.isError ? retry : close).current ?? heading.current)?.focus();
  }, [data.isFetching, data.isError]);

  const currency = String(features.query.data?.CURRENCY ?? "USD");
  const priceTracking = features.enabled("STOCK_PRICE_TRACKING");

  const formatVersion = JSON.stringify([
    preferences.amountPrecision,
    preferences.priceDisplayPrecision,
    currency,
    locale,
    priceTracking,
  ]);

  useLayoutEffect(() => {
    if (!ready || !features.query.isSuccess || !settings.isSuccess) return;
    memory.configure(
      {
        amountPrecision: preferences.amountPrecision,
        pricePrecision: preferences.priceDisplayPrecision,
        currency,
        priceTracking,
        now: new Date(),
        locale: t("moment_locale"),
        t,
        pluralIndex,
      },
      formatVersion,
    );
  }, [
    memory,
    ready,
    features.query.isSuccess,
    settings.isSuccess,
    formatVersion,
    preferences.amountPrecision,
    preferences.priceDisplayPrecision,
    currency,
    priceTracking,
    t,
    pluralIndex,
  ]);

  const value = snapshot.view;
  const name = value.name;
  const actionId = value.actionProductId;

  const description = useQuery({
    queryKey: ["product-overview-description", value.descriptionProductId, value.description],
    queryFn: () => api.getContent("products", value.descriptionProductId ?? productId),
    enabled: !!value.description && value.descriptionVisible,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  return (
    <>
      <div className="section-heading">
        <h2 id={title} ref={heading} tabIndex={-1}>
          {t("Product overview")}
        </h2>
        {onClose ? (
          <button ref={close} type="button" className="btn btn-ghost" onClick={onClose}>
            {t("Close")}
          </button>
        ) : null}
      </div>
      {data.isPending || data.isFetching || !ready ? <LoadingBlock /> : null}
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button
            ref={retry}
            type="button"
            className="btn"
            onClick={() => {
              focusAfterRead.current = true;
              void data.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {snapshot.hasRead ? (
        <>
          <div className="toolbar product-overview-actions">
            {embedded || actionId === null ? (
              <button
                type="button"
                className="btn"
                disabled={actionId === null}
                onClick={() => setEditing(true)}
              >
                {t("Edit product")}
              </button>
            ) : (
              <Link
                to="/product/$productId"
                params={{ productId: String(actionId) }}
                search={{ returnto }}
                className="btn"
              >
                {t("Edit product")}
              </Link>
            )}
            {features.enabled("SHOPPINGLIST") ? (
              <button
                type="button"
                className="btn"
                disabled={actionId === null}
                onClick={() => shopping.open(true)}
              >
                {t("Add to shopping list")}
              </button>
            ) : null}
            <ProductJournal
              productId={actionId ?? productId}
              name={name}
              disabled={actionId === null}
            />
            <ProductEntries
              productId={actionId ?? productId}
              name={name}
              disabled={actionId === null}
            />
          </div>
          <h3>{name}</h3>
          {value.descriptionVisible ? (
            <div className="product-overview-description">
              {description.isPending ? <LoadingBlock /> : null}
              {description.error ? (
                <>
                  <ErrorBlock message={description.error.message} />
                  <button type="button" className="btn" onClick={() => void description.refetch()}>
                    {t("Retry")}
                  </button>
                </>
              ) : null}
              {description.data ? (
                <>
                  <div id={descriptionId} data-expanded={expanded}>
                    <RichText html={description.data.html} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-controls={descriptionId}
                    aria-expanded={expanded}
                    onClick={() => onExpandedChange(!expanded)}
                  >
                    {t(expanded ? "Show less" : "Show more")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <dl className="product-overview-facts">
            <div>
              <dt>{t("Stock amount")}</dt>
              <dd>
                {!value.noOwnStock ? <span>{`${value.ownAmount} ${value.ownUnit}`}</span> : null}
                {value.ownOpened ? <small> {value.ownOpened}</small> : null}
                {value.aggregateVisible ? (
                  <span className="product-overview-aggregate">
                    <span aria-label={t("Total stock")}>Σ </span>
                    {`${value.aggregateAmount} ${value.aggregateUnit}`}
                    {value.aggregateOpened ? <small> {value.aggregateOpened}</small> : null}
                  </span>
                ) : null}
              </dd>
            </div>
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <div>
                <dt>{t("Stock value")}</dt>
                <dd>{value.stockValue}</dd>
              </div>
            ) : null}
            {features.enabled("STOCK_LOCATION_TRACKING") ? (
              <div>
                <dt>{t("Default location")}</dt>
                <dd>{value.location}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Last purchased")}</dt>
              <dd>
                <StockTableDate value={value.lastPurchased} />
              </dd>
            </div>
            <div>
              <dt>{t("Last used")}</dt>
              <dd>
                <StockTableDate value={value.lastUsed} />
              </dd>
            </div>
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <>
                <div>
                  <dt>{t("Last price")}</dt>
                  <dd>
                    <span title={value.lastPrice.title}>{value.lastPrice.text}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t("Average price")}</dt>
                  <dd>
                    <span title={value.averagePrice.title}>{value.averagePrice.text}</span>
                  </dd>
                </div>
              </>
            ) : null}
            {features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
              <div>
                <dt>{t("Average shelf life")}</dt>
                <dd>{value.shelfLife}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Spoil rate")}</dt>
              <dd>{value.spoilRate}</dd>
            </div>
          </dl>
          {value.picture ? (
            <EntityPicture
              group="productpictures"
              source={value.picture}
              label={t("%s picture", name)}
            />
          ) : null}
          {features.enabled("STOCK_PRICE_TRACKING") && value.history ? (
            <ProductPriceHistory
              state={snapshot.history}
              onRetry={memory.retryHistory}
              currency={currency}
            />
          ) : null}
          {shopping.state ? (
            <ShoppingItemForm
              listId={1}
              options={{ product: actionId ?? productId, merge: true }}
              onClose={closeShopping}
              onSaved={async () => {
                await client.invalidateQueries({ queryKey: ["shopping"] });
                closeShopping();
              }}
            />
          ) : null}
          {editing ? (
            <OverviewEditor
              productId={actionId ?? productId}
              onReturn={async () => {
                await onReturn();
                onClose?.();
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function OverviewEditor({
  productId,
  onReturn,
}: {
  productId: number;
  onReturn: () => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [pending, setPending] = useState(false);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-journal-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        void onReturn();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("Edit product")}</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => void onReturn()}
        >
          {t("Close")}
        </button>
      </div>
      <ProductEditor
        editor={{
          recordId: productId,
          allowReturn: false,
          continueLabel: "Save & continue",
          onSaved: async () => onReturn(),
          onCancel: () => void onReturn(),
        }}
        onPendingChange={setPending}
      />
    </dialog>
  );
}
