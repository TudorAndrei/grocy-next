import { useRouter } from "@tanstack/react-router";
import { NativePageDialog } from "./NativePageDialog";

export function NativeStockPageDialog({
  kind,
  productId,
  onClose,
}: {
  kind: "stockentries" | "stockjournal";
  productId: number;
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <NativePageDialog
      url={
        router.buildLocation({ to: `/${kind}`, search: {} }).publicHref +
        `?embedded&product=${productId}`
      }
      dialogType="table"
      onClose={onClose}
    />
  );
}
