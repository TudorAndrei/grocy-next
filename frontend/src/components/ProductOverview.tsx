import { useEffect, useId, useRef, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { tableDate } from "@/lib/native-table-cell";
import { getProductOverview } from "@/lib/product-overview";
import { useModalDialog } from "@/hooks/useModalDialog";
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

export function ProductOverview({
  productId,
  embedded,
  expanded,
  onExpandedChange,
  onReturn,
  onClose,
}: {
  productId: number;
  embedded: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onReturn: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, pluralIndex, ready } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const returnto = useLocation({ select: (location) => location.href });
  const dialog = useModalDialog();
  const close = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const focusAfterRead = useRef(false);
  const title = useId();
  const descriptionId = useId();
  const [shopping, setShopping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [now] = useState(() => new Date());

  const data = useQuery({
    queryKey: ["product-overview", productId],
    queryFn: ({ signal }) => getProductOverview(productId, signal),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (data.isFetching || !focusAfterRead.current) return;
    focusAfterRead.current = false;
    (data.isError ? retry : close).current?.focus();
  }, [data.isFetching, data.isError]);

  const description = useQuery({
    queryKey: ["product-overview-description", productId],
    queryFn: () => api.getContent("products", productId),
    enabled: !!data.data?.product.description && !data.isFetching,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const value = data.isSuccess && !data.isFetching && ready ? data.data : undefined;
  const name = value?.product.name ?? "";
  const currency = String(features.query.data?.CURRENCY ?? "USD");

  const number = (amount: number) =>
    amount.toLocaleString(undefined, { maximumFractionDigits: preferences.amountPrecision });

  const quantity = (amount: number) =>
    `${number(amount)} ${unitLabel(value ? { ...value.quantity_unit_stock, name: value.quantity_unit_stock.name ?? "" } : undefined, amount, pluralIndex, false)}`;

  const money = (amount: number) => preferences.formatCurrency(amount, currency);

  const price = (amount: number) =>
    t(
      "%1$s per %2$s",
      money(amount * (value?.qu_conversion_factor_price_to_stock ?? 1)),
      value?.quantity_unit_price.name ?? "",
    );

  const stockPrice = (amount: number) =>
    t("%1$s per %2$s", money(amount), value?.quantity_unit_stock.name ?? "");

  const date = (source: string | null) => {
    const value = tableDate(source || "2999-12-31", now, t("moment_locale"), t);

    return (
      <StockTableDate
        value={{ ...value, date: value.date === source ? value.date.slice(0, 10) : value.date }}
      />
    );
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog product-overview-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("Product overview")}</h2>
        <button ref={close} type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
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
      {value ? (
        <>
          <div className="toolbar product-overview-actions">
            {embedded ? (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                {t("Edit product")}
              </button>
            ) : (
              <Link
                to="/product/$productId"
                params={{ productId: String(productId) }}
                search={{ returnto }}
                className="btn"
              >
                {t("Edit product")}
              </Link>
            )}
            {features.enabled("SHOPPINGLIST") ? (
              <button type="button" className="btn" onClick={() => setShopping(true)}>
                {t("Add to shopping list")}
              </button>
            ) : null}
            <ProductJournal productId={productId} name={name} disabled={false} />
            <ProductEntries productId={productId} name={name} disabled={false} />
          </div>
          <h3>{name}</h3>
          {value.product.description ? (
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
                {value.product.no_own_stock !== 1 ? (
                  <span>{quantity(value.stock_amount)}</span>
                ) : null}
                {value.stock_amount_opened > 0 ? (
                  <small> {t("%s opened", value.stock_amount_opened.toLocaleString())}</small>
                ) : null}
                {value.is_aggregated_amount === 1 ? (
                  <span className="product-overview-aggregate">
                    <span aria-label={t("Total stock")}>Σ </span>
                    {quantity(value.stock_amount_aggregated)}
                    {value.stock_amount_opened_aggregated > 0 ? (
                      <small>
                        {" "}
                        {t("%s opened", value.stock_amount_opened_aggregated.toLocaleString())}
                      </small>
                    ) : null}
                  </span>
                ) : null}
              </dd>
            </div>
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <div>
                <dt>{t("Stock value")}</dt>
                <dd>{money(value.stock_value)}</dd>
              </div>
            ) : null}
            {features.enabled("STOCK_LOCATION_TRACKING") ? (
              <div>
                <dt>{t("Default location")}</dt>
                <dd>{value.location?.name}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Last purchased")}</dt>
              <dd>{date(value.last_purchased)}</dd>
            </div>
            <div>
              <dt>{t("Last used")}</dt>
              <dd>{date(value.last_used)}</dd>
            </div>
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <>
                <div>
                  <dt>{t("Last price")}</dt>
                  <dd>
                    {value.last_price === null ? (
                      t("Unknown")
                    ) : (
                      <span title={stockPrice(value.last_price)}>{price(value.last_price)}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("Average price")}</dt>
                  <dd>
                    {value.avg_price === null ? (
                      t("Unknown")
                    ) : (
                      <span title={stockPrice(value.avg_price)}>{price(value.avg_price)}</span>
                    )}
                  </dd>
                </div>
              </>
            ) : null}
            {features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
              <div>
                <dt>{t("Average shelf life")}</dt>
                <dd>
                  {value.average_shelf_life_days === -1
                    ? t("Unknown")
                    : value.average_shelf_life_days > 73000
                      ? t("Unlimited")
                      : moment
                          .duration(value.average_shelf_life_days, "days")
                          .locale(t("moment_locale"))
                          .humanize()}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Spoil rate")}</dt>
              <dd>
                {(value.spoil_rate_percent / 100).toLocaleString(undefined, { style: "percent" })}
              </dd>
            </div>
          </dl>
          {value.product.picture_file_name ? (
            <EntityPicture
              group="productpictures"
              source={value.product.picture_file_name}
              label={t("%s picture", name)}
            />
          ) : null}
          {features.enabled("STOCK_PRICE_TRACKING") ? (
            <ProductPriceHistory
              productId={productId}
              factor={value.qu_conversion_factor_price_to_stock}
              currency={currency}
            />
          ) : null}
          {shopping ? (
            <ShoppingItemForm
              listId={1}
              options={{ product: productId, merge: true }}
              onClose={() => setShopping(false)}
              onSaved={async () => {
                await client.invalidateQueries({ queryKey: ["shopping"] });
                setShopping(false);
              }}
            />
          ) : null}
          {editing ? (
            <OverviewEditor
              productId={productId}
              onReturn={async () => {
                await onReturn();
                onClose();
              }}
            />
          ) : null}
        </>
      ) : null}
    </dialog>
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

        if (!pending) void onReturn();
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
