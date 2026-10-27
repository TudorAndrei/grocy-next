import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { downloadApiDocument } from "@/lib/open-document";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

type CalendarTab = "agenda" | "export";

type AgendaItem = {
  id: string;
  when: string;
  label: string;
  allDay: boolean;
};

type CalendarEvent = {
  title: string;
  start: string | null;
  date_format: "date" | "datetime";
  allDay?: boolean;
};

function parseWhen(value: string | null | undefined): string | null {
  if (!value || String(value).startsWith("2999-")) return null;
  const text = String(value).replace(" ", "T");
  const date = new Date(text.length === 10 ? text + "T00:00:00" : text);

  return Number.isNaN(date.getTime()) ? null : text;
}

function CalendarPage() {
  const [tab, setTab] = useState<CalendarTab>("agenda");
  const [showLink, setShowLink] = useState(false);

  const events = useQuery({
    queryKey: ["calendar", "events"],
    queryFn: () => request<CalendarEvent[]>("/api/v2/calendar/events"),
  });

  const sharing = useQuery({
    queryKey: ["calendar-link"],
    queryFn: () => request<{ url: string }>("/api/calendar/ical/sharing-link"),
    enabled: showLink,
  });

  const download = useMutation({
    mutationFn: () => downloadApiDocument("/api/calendar/ical", "Grocy.ics"),
  });

  const agenda: AgendaItem[] = [];

  for (const [index, row] of (events.data ?? []).entries()) {
    const when = parseWhen(row.start);

    if (!when) continue;
    agenda.push({
      id: String(index),
      when,
      allDay: row.date_format === "date" || Boolean(row.allDay),
      label: row.title,
    });
  }

  agenda.sort((a, b) => a.when.localeCompare(b.when));

  const loading = events.isLoading;
  const error = events.error || sharing.error || download.error;

  return (
    <>
      <PageHeader
        title="Calendar"
        lead="Stock due dates, meals, tasks, chores, and battery charges."
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
        {agenda.length === 0 && !loading && !events.error ? (
          <p className="empty-state">Nothing scheduled with a due date yet.</p>
        ) : (
          <ul className="agenda-list">
            {agenda.map((item) => (
              <li key={item.id} className="agenda-item">
                <time dateTime={item.when}>
                  {item.allDay
                    ? new Date(item.when.slice(0, 10) + "T00:00:00").toLocaleDateString()
                    : new Date(item.when).toLocaleString()}
                </time>
                <span className="badge">{item.allDay ? "All day" : "Timed"}</span>
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
