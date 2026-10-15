import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
export const Route = createFileRoute("/calendar")({ component: CalendarPage });
function CalendarPage() {
  const [showLink, setShowLink] = useState(false);
  const sharing = useQuery({
    queryKey: ["calendar-link"],
    queryFn: () => request<{ url: string }>("/api/calendar/ical/sharing-link"),
    enabled: showLink,
  });
  const download = useMutation({
    mutationFn: async () => {
      const text = await request<string>("/api/calendar/ical");
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/calendar" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "Grocy.ics";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <>
      <h1 className="page-title">Calendar</h1>
      <p className="page-lead">
        Export product due dates, planned meals, tasks, chores, and battery
        charges to your calendar application.
      </p>
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
      {(sharing.error || download.error) && (
        <ErrorBlock message={(sharing.error || download.error)!.message} />
      )}
      {sharing.data && (
        <div className="field">
          <label htmlFor="calendar-link">Calendar subscription URL</label>
          <input
            id="calendar-link"
            readOnly
            value={sharing.data.url}
            onFocus={(e) => e.target.select()}
          />
          <p className="muted">
            Use this URL to subscribe. Anyone with this URL can read your
            calendar. Revoke the calendar key under Manage to remove access.
          </p>
        </div>
      )}
    </>
  );
}
