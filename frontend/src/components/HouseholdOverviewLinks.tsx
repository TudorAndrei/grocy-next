import { useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions";
import type { TrackingKind } from "@/lib/household-tracking";
import { householdEditPath } from "@/lib/household-master";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

export function HouseholdOverviewLinks({ kind, id }: { kind: TrackingKind; id: number }) {
  const { t } = useI18n();
  const can = usePermissions();
  const [page, setPage] = useState<EmbeddedPage>();

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setPage({
      id: Date.now(),
      url: event.currentTarget.href,
      dialogType: event.currentTarget.pathname.includes("journal") ? "table" : "",
    });
  };

  return (
    <>
      {can("MASTER_DATA_EDIT") ? (
        <Link
          className="btn btn-ghost btn-sm"
          to={householdEditPath(kind === "chore" ? "chores" : "batteries", id)}
          search={kind === "battery" ? { embedded: "" } : {}}
          onClick={kind === "battery" ? open : undefined}
        >
          {t(kind === "chore" ? "Edit chore" : "Edit battery")}
        </Link>
      ) : null}
      <Link
        className="btn btn-ghost btn-sm"
        to={kind === "chore" ? "/choresjournal" : "/batteriesjournal"}
        search={
          kind === "chore"
            ? { embedded: "", chore: String(id) }
            : { embedded: "", battery: String(id) }
        }
        onClick={open}
      >
        {t(kind === "chore" ? "Chore journal" : "Battery journal")}
      </Link>
      {page ? <EmbeddedPageDialog page={page} onClose={() => setPage(undefined)} /> : null}
    </>
  );
}
