import { useEffect, useRef, useState } from "react";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

/** Native show-as-dialog links always belong to the highest Grocy document. */
export function NativePageDialog({
  url,
  dialogType = "form",
  onClose,
}: {
  url: string;
  dialogType?: string;
  onClose: () => void;
}) {
  const [destination] = useState(getTopmostGrocyWindow);
  const forwarded = useRef(false);

  const [page] = useState<EmbeddedPage>(() => ({
    id: 0,
    url: new URL(url, window.location.href).href,
    dialogType,
  }));

  useEffect(() => {
    if (destination === window || forwarded.current) return;
    forwarded.current = true;
    destination.postMessage(
      {
        Message: "IframeModal",
        Payload: { Link: page.url, DialogType: page.dialogType },
      },
      window.location.origin,
    );
    onClose();
  }, [destination, page, onClose]);

  return destination === window ? <EmbeddedPageDialog page={page} onClose={onClose} /> : null;
}
