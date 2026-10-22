import type { ReactNode } from "react";

export type TabItem<T extends string> = {
  id: T;
  label: string;
};

type TabsProps<T extends string> = {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
};

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          aria-pressed={value === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

type TabPanelProps = {
  id: string;
  labelledBy: string;
  hidden: boolean;
  children: ReactNode;
};

export function TabPanel({ id, labelledBy, hidden, children }: TabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      className="tab-panel"
    >
      {children}
    </div>
  );
}
