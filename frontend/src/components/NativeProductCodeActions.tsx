import { useRouter } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";

export function NativeProductCodeActions({
  productId,
  onPrint,
}: {
  productId: number;
  onPrint: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const features = useFeatures();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");

  return (
    <div className="actions">
      <a
        className="btn btn-ghost btn-sm"
        href={`${root}/product/${productId}/grocycode?download=true`}
      >
        {t("Download")}
      </a>
      {features.enabled("LABEL_PRINTER") ? (
        <a
          className="btn btn-ghost btn-sm product-grocycode-label-print"
          data-product-id={productId}
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onPrint();
          }}
        >
          {t("Print on label printer")}
        </a>
      ) : null}
    </div>
  );
}
