import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { batteriesQuery, choresQuery, objectsQuery, tasksQuery } from "@/hooks/queries";
import { downloadApiDocument } from "@/lib/open-document";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

type CalendarTab = "agenda" | "export";

type AgendaItem = {
  id: string;
  when: string;
  label: string;
  kind: string;
};

function parseWhen(value: string | null | undefined): string | null {
  if (!value || String(value).startsWith("2999-")) return null;
  const text = String(value).replace(" ", "T");
  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function CalendarPage() {
  const [tab, setTab] = useState<CalendarTab>("agenda");
  const [showLink, setShowLink] = useState(false);
  const meals = useQuery(objectsQuery("meal_plan"));
  const tasks = useQuery(tasksQuery(true));
  const chores = useQuery(choresQuery());
  const batteries = useQuery(batteriesQuery());

  const sharing = useQuery({
    queryKey: ["calendar-link"],
    queryFn: () => request<{ url: string }>("/api/calendar/ical/sharing-link"),
    enabled: showLink,
  });

  const download = useMutation({
    mutationFn: () => downloadApiDocument("/api/calendar/ical", "Grocy.ics"),
  });

  const agenda: AgendaItem[] = [];

  for (const row of meals.data ?? []) {
    const when = parseWhen(row.day);

    if (!when) continue;
    agenda.push({
      id: `meal-${row.id}`,
      when,
      kind: "Meal",
      label: String(row.note ?? row.type ?? "Meal plan entry"),
    });
  }

  for (const row of tasks.data ?? []) {
    const when = parseWhen(row.due_date);

    if (!when) continue;
    agenda.push({
      id: `task-${row.id}`,
      when,
      kind: "Task",
      label: row.name,
    });
  }

  for (const row of chores.data ?? []) {
    const when = parseWhen(row.next_estimated_execution_time);

    if (!when) continue;
    agenda.push({
      id: `chore-${row.id}`,
      when,
      kind: "Chore",
      label: row.chore_name ?? row.name ?? "Chore",
    });
  }

  for (const row of batteries.data ?? []) {
    const when = parseWhen(row.next_estimated_charge_time);

    if (!when) continue;
    agenda.push({
      id: `battery-${row.id}`,
      when,
      kind: "Battery",
      label: row.battery?.name ?? row.name ?? "Battery",
    });
  }

  agenda.sort((a, b) => a.when.localeCompare(b.when));

  const loading = meals.isLoading || tasks.isLoading || chores.isLoading || batteries.isLoading;

  const error =
    meals.error ||
    tasks.error ||
    chores.error ||
    batteries.error ||
    sharing.error ||
    download.error;

  return (
    <>
      <PageHeader
        title="Calendar"
        lead="Upcoming meals, tasks, chores, and battery charges — or export the full iCal feed."
      />
      <Tabs
        ariaLabel="Calendar views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "agenda", label: "Agenda" },
          { id: "export", label: "Export" },
        ]}
      />
      {error ? <ErrorBlock message={error.message} /> : null}
      <TabPanel id="cal-agenda" labelledBy="tab-agenda" hidden={tab !== "agenda"}>
        {loading ? <LoadingBlock label="Loading agenda…" /> : null}
        {agenda.length === 0 && !loading ? (
          <p className="empty-state">Nothing scheduled with a due date yet.</p>
        ) : (
          <ul className="agenda-list">
            {agenda.map((item) => (
              <li key={item.id} className="agenda-item">
                <time dateTime={item.when}>{new Date(item.when).toLocaleString()}</time>
                <span className="badge">{item.kind}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
      <TabPanel id="cal-export" labelledBy="tab-export" hidden={tab !== "export"}>
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            Download calendar
          </button>
          <button className="btn btn-ghost" onClick={() => setShowLink(true)}>
            Show subscription link
          </button>
        </div>
        {sharing.data ? (
          <div className="field">
            <label htmlFor="calendar-url">Subscription URL</label>
            <input id="calendar-url" readOnly value={sharing.data.url} />
          </div>
        ) : null}
      </TabPanel>
    </>
  );
}
