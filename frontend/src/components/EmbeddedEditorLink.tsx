import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

export function EmbeddedEditorLink({
  to,
  children,
  className = "btn",
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const [page, setPage] = useState<EmbeddedPage>();

  return (
    <>
      <Link
        to={to}
        search={{ embedded: "" }}
        className={className}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          setPage({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
        }}
      >
        {children}
      </Link>
      {page ? <EmbeddedPageDialog page={page} onClose={() => setPage(undefined)} /> : null}
    </>
  );
}
