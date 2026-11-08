import moment from "moment";
import { useEffect, useEffectEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, request } from "@/lib/api";
import { useNativeDocumentReload } from "@/lib/native-document";
import { usePreferences } from "@/lib/preferences";
import type { CurrentUser } from "@/lib/types";

/** Native database changes replace an idle, clean document instead of its query data. */
export function NativeDatabaseRefresh() {
  const client = useQueryClient();
  const [userId] = useState(() => client.getQueryData<CurrentUser>(queryKeys.currentUser)?.id);
  const { autoReload } = usePreferences();
  const reload = useNativeDocumentReload();

  const changed = useEffectEvent(() => {
    if (
      autoReload &&
      !document.querySelector("form.is-dirty") &&
      !document.body.classList.contains("fullscreen-card")
    )
      reload();
  });

  useEffect(() => {
    const owner = new AbortController();
    let baseline: moment.Moment | undefined;
    let idle = 0;

    const read = (initial = false) => {
      void request<{ changed_time?: moment.MomentInput }>("/api/system/db-changed-time", {
        signal: owner.signal,
      })
        .then((result) => {
          if (owner.signal.aborted) return;
          const time = moment(result.changed_time);

          if (initial) baseline = time;
          else if (time.isAfter(baseline)) {
            if (idle >= 50) changed();
            // A change is consumed even when activity, a dirty form or settings block reload.
            baseline = time;
          }
        })
        .catch((error: Error) => {
          if (!owner.signal.aborted) console.error(error);
        });
    };

    if (userId !== -1) read(true);
    const poll = window.setInterval(read, 60_000);
    const tick = window.setInterval(() => idle++, 1000);

    const activity = () => {
      idle = 0;
    };

    const events = ["mousemove", "mousedown", "click", "scroll", "keypress"];

    for (const event of events) window.addEventListener(event, activity);
    window.addEventListener("grocy-native-activity", activity);

    const dirty = (event: Event) => {
      if (!(event.target instanceof Element)) return;

      const target = event.target.closest(event.type === "click" ? "select" : "input, textarea");

      if (!target) return;
      target.classList.add("is-dirty");
      target.closest("form")?.classList.add("is-dirty");
    };

    for (const event of ["keyup", "paste", "change", "click"])
      document.addEventListener(event, dirty);

    return () => {
      owner.abort();
      window.clearInterval(poll);
      window.clearInterval(tick);

      for (const event of events) window.removeEventListener(event, activity);
      window.removeEventListener("grocy-native-activity", activity);

      for (const event of ["keyup", "paste", "change", "click"])
        document.removeEventListener(event, dirty);
    };
  }, [userId]);

  return null;
}
