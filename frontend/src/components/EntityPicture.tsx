import { useEffect, useId, useRef, useState } from "react";
import { filePath } from "@/lib/api";
import { fetchApiDocument } from "@/lib/open-document";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export type PictureUpload = { file: File; name: string };

export type PictureSelection = {
  original: string | null;
  upload: PictureUpload | null;
  remove: boolean;
};

type PictureGroup = "productpictures" | "recipepictures";

type PictureResult = { source: File | string; group: PictureGroup } & (
  | { url: string }
  | { error: string }
);

export function EntityPicture({
  group,
  source,
  label,
}: {
  group: PictureGroup;
  source: File | string;
  label: string;
}) {
  const [result, setResult] = useState<PictureResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;

    const document =
      source instanceof File
        ? Promise.resolve(source)
        : fetchApiDocument(
            `${filePath(group, source)}?force_serve_as=picture&best_fit_width=400`,
            controller.signal,
          );

    void document
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResult({ group, source, url: objectUrl });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setResult({
            group,
            source,
            error: error.message,
          });
      });

    return () => {
      controller.abort();

      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [group, source]);

  if (!result || result.source !== source || result.group !== group)
    return <LoadingBlock label="Loading picture…" />;

  if ("error" in result) return <ErrorBlock message={result.error} />;

  return <img className="entity-picture" src={result.url} alt={label} />;
}

export function EntityPictureDetails({
  group,
  name,
  label,
}: {
  group: PictureGroup;
  name: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>View picture</summary>
      {open ? <EntityPicture group={group} source={name} label={label} /> : null}
    </details>
  );
}

export function EntityPictureField({
  group,
  value,
  onChange,
  disabled,
  label,
}: {
  group: PictureGroup;
  value: PictureSelection;
  onChange: (value: PictureSelection) => void;
  disabled: boolean;
  label: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const source = value.upload?.file ?? (value.remove ? null : value.original);

  useEffect(() => {
    if (!value.upload && input.current) input.current.value = "";
  }, [value.upload]);

  return (
    <div className="field entity-picture-field">
      <label htmlFor={id}>{label}</label>
      {source ? <EntityPicture group={group} source={source} label={label} /> : null}
      <input
        id={id}
        ref={input}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          const extension = file?.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "png";
          const upload = file ? { file, name: `${crypto.randomUUID()}.${extension}` } : null;

          onChange({ ...value, upload, remove: file ? false : value.remove });
        }}
      />
      {value.upload ? <p className="field-hint">New picture: {value.upload.file.name}</p> : null}
      {source ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={() => onChange({ ...value, upload: null, remove: true })}
        >
          Remove picture
        </button>
      ) : null}
    </div>
  );
}
