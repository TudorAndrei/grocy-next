import type { ReactNode } from "react";

export function AuthCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className="setup-page">
      <section className="panel setup-panel">
        <div className="panel-inner">
          <p className="wordmark">
            Grocy <span>Next</span>
          </p>
          <h1 className="panel-title">{title}</h1>
          <p className="muted">{lead}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
