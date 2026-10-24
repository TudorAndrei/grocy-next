import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
};

export function PageHeader({ title, lead, actions, back }: PageHeaderProps) {
  return (
    <header className="page-header">
      {back}
      <div className="page-header-row">
        <div className="page-header-copy">
          <h1 className="page-title">{title}</h1>
          {lead ? <p className="page-lead">{lead}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
