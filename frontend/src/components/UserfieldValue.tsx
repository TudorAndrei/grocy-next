import { Fragment, useState } from "react";
import { z } from "zod";
import { filePath } from "@/lib/api";
import { openApiDocument } from "@/lib/open-document";
import { userfieldFile, type UserfieldDefinition } from "@/lib/userfields";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";
import { Icon } from "./Icon";

const titledLink = z.object({ title: z.string().nullish(), link: z.string().nullish() });

function linkTarget(value: string) {
  try {
    const url = new URL(value, window.location.href);

    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function UserfieldValue({
  field,
  value,
}: {
  field: UserfieldDefinition;
  value: string | null;
}) {
  const { t } = useI18n();
  const preferences = usePreferences();
  const features = useFeatures();
  const [error, setError] = useState<Error>();

  if (value === null) return null;

  if (field.type === "checkbox")
    return Number(value) === 1 ? (
      <span aria-label={t("Yes")}>
        <Icon name="check" />
      </span>
    ) : null;

  if (field.type === "preset-checklist")
    return value.split(",").map((item, index) => (
      <Fragment key={index}>
        {index ? <br /> : null}
        {item}
      </Fragment>
    ));

  if (field.type === "number-decimal")
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (field.type === "number-currency")
    return preferences.formatCurrency(
      Number(value),
      String(features.query.data?.CURRENCY ?? "USD"),
    );

  if (field.type === "link-with-title") {
    let link: z.infer<typeof titledLink>;

    try {
      link = titledLink.parse(JSON.parse(value));
    } catch {
      return null;
    }

    return (
      <a href={linkTarget(link.link ?? "")} target="_blank" rel="noopener noreferrer">
        {link.title}
      </a>
    );
  }

  if (field.type === "link")
    return (
      <a href={linkTarget(value)} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    );

  if ((field.type === "file" || field.type === "image") && value) {
    const file = userfieldFile(value);

    const open = () => {
      setError(undefined);
      void openApiDocument(
        `${filePath("userfiles", file.name)}${field.type === "image" ? "?force_serve_as=picture" : ""}`,
      ).catch((error: Error) => setError(error));
    };

    return (
      <>
        <button type="button" className="btn btn-ghost btn-sm" onClick={open}>
          {field.type === "image" ? (
            <EntityPicture
              group="userfiles"
              source={file.name}
              label={file.display}
              width={32}
              height={32}
            />
          ) : (
            file.display
          )}
        </button>
        {error ? <ErrorBlock message={error.message} /> : null}
      </>
    );
  }

  return <>{value}</>;
}
