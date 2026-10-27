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
  if (userId == null || currentUserId === undefined) return <span className="tag">—</span>;

  if (userId === currentUserId) return <span className="tag">You</span>;

  return (
    <span className="tag" data-domain="agent" title={`Booked with the API key of user #${userId}`}>
      User #{userId}
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
