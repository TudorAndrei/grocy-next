import { useI18n } from "@/lib/i18n";

/**
 * Who made a booking. The API knows only the user behind the API key, so an
 * agent shows as its own user when it has its own key; we never guess.
 */
export function ActorTag({
  userId,
  currentUserId,
}: {
  userId: number | null | undefined;
  currentUserId: number | undefined;
}) {
  const { t: tr } = useI18n();

  if (userId == null || currentUserId === undefined) return <span className="tag">—</span>;

  if (userId === currentUserId) return <span className="tag">{tr("You")}</span>;

  return (
    <span
      className="tag"
      data-domain="agent"
      title={tr("Booked with the API key of user #%s", String(userId))}
    >
      {tr("User #")}
      {userId}
    </span>
  );
}

const VERBS = new Map<string, string>(
  Object.entries({
    purchase: "Bought",
    consume: "Used",
    "product-opened": "Opened",
    "inventory-correction": "Corrected",
    transfer: "Moved",
  }),
);

export function bookingVerb(type: string): string {
  return VERBS.get(type) ?? type.replace(/[-_]/g, " ");
}
