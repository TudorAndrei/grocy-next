(() => {
  const origin = window.location.origin;
  let calendar;
  let disposed = false;
  let responsive = false;
  let observer;

  const send = (kind, data = {}) => {
    if (!disposed)
      window.parent.postMessage({ channel: "grocy-native-calendar", kind, ...data }, origin);
  };
  const measure = () => send("height", { height: document.body.scrollHeight });
  const applyTheme = (theme) => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme.mode;
    for (const name of ["--surface", "--ink", "--line", "--surface-sunk"]) {
      if (typeof theme.tokens?.[name] === "string")
        document.documentElement.style.setProperty(name, theme.tokens[name]);
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    calendar?.fullCalendar("destroy");
    calendar = undefined;
  };
  window.addEventListener("pagehide", dispose);
  window.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLScriptElement) send("error");
    },
    true,
  );
  window.addEventListener("message", (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== "grocy-native-calendar") return;
    if (data.kind === "dispose") {
      dispose();
      return;
    }
    if (disposed) return;
    if (data.kind === "theme") {
      applyTheme(data.theme);
      return;
    }
    if (data.kind === "resize" && calendar && !responsive) {
      responsive = true;
      calendar.fullCalendar("changeView", data.viewportWidth < 768 ? "agendaDay" : "month");
      measure();
      return;
    }
    if (data.kind !== "configure" || calendar || !Array.isArray(data.events)) return;
    try {
      document.title = `${data.title} | Grocy`;
      document.documentElement.lang = data.locale;
      applyTheme(data.theme);
      const momentLocale = data.momentLocale === "x" ? "en" : data.momentLocale;
      const calendarLocale = data.calendarLocale === "x" ? "en" : data.calendarLocale;
      moment.locale(moment.locales().includes(momentLocale) ? momentLocale : "en");
      const first = data.config.CALENDAR_FIRST_DAY_OF_WEEK;
      const weekNumbers = data.config.CALENDAR_SHOW_WEEK_OF_YEAR;
      calendar = jQuery("#calendar").fullCalendar({
        themeSystem: "bootstrap4",
        header: {
          left: "month,agendaWeek,agendaDay,listWeek",
          center: "title",
          right: "prev,today,next",
        },
        locale: jQuery.fullCalendar.locales[calendarLocale] ? calendarLocale : "en",
        weekNumbers: !!weekNumbers && weekNumbers !== "0",
        defaultView: data.viewportWidth < 768 ? "agendaDay" : "month",
        firstDay:
          first === "" || first === false || first === null || first === undefined
            ? null
            : Number.parseInt(first === true ? "1" : String(first)),
        eventLimit: false,
        height: "auto",
        eventSources: [data.events],
        eventClick: (info) => {
          send("navigate", { link: info.link });
          return false;
        },
        timeFormat: "HH:mm",
        viewRender: () => requestAnimationFrame(measure),
        eventAfterAllRender: () => requestAnimationFrame(measure),
      });
      if (window.ResizeObserver) {
        observer = new ResizeObserver(measure);
        observer.observe(document.body);
      }
      measure();
      send("ready");
    } catch (error) {
      console.error(error);
      send("error");
    }
  });
})();
