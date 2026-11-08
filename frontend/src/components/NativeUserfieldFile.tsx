import type { ReactNode } from "react";
import { useDialogState } from "@/hooks/useDialogState";
import { useFeatures } from "@/lib/features";
import { nativeUserfieldFileDisplay } from "@/lib/native-userfield-file";
import { nativeUserfileUrl } from "@/lib/native-userfields-clear";
import type { UserfieldDefinition } from "@/lib/userfields";
import { NativePageDialog } from "./NativePageDialog";

export function NativeUserfieldFile({
  field,
  value,
}: {
  field: UserfieldDefinition;
  value: string | null;
}) {
  const features = useFeatures();
  const dialog = useDialogState<string>();
  let content: ReactNode = value;

  if (value && value !== "0") {
    const display = nativeUserfieldFileDisplay(
      value,
      field.type === "image" ? "attribute" : "text",
    );

    const url = nativeUserfileUrl(value, features.query.data);

    content =
      field.type === "image" ? (
        <a
          className="show-as-dialog-link"
          href={`${url}?force_serve_as=picture`}
          onClick={(event) => {
            if (event.button !== 0) return;

            event.preventDefault();
            dialog.open(event.currentTarget.href);
          }}
        >
          <img
            src={`${url}?force_serve_as=picture&best_fit_width=32&best_fit_height=32`}
            title={display}
            alt={display}
            loading="lazy"
          />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noopener">
          {display}
        </a>
      );
  }

  const opened = dialog.state;

  return (
    <>
      {content}
      {opened ? (
        <NativePageDialog
          key={opened.id}
          url={opened.value}
          onClose={() => dialog.close(opened.id)}
        />
      ) : null}
    </>
  );
}
