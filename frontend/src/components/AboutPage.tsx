import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAboutContext,
  initialAboutTab,
  type AboutContext,
  type ChangelogRelease,
} from "@/lib/about-page";
import { useI18n } from "@/lib/i18n";
import { tableDate } from "@/lib/native-table-cell";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { RichText } from "./RichDescription";
import { Tabs, TabPanel } from "./ui/Tabs";

type AboutTab = "system-info" | "changelog";

export function AboutPage({ search }: { search: string }) {
  const { t } = useI18n();

  const data = useQuery({
    queryKey: ["native-about"],
    queryFn: ({ signal }) => getAboutContext(signal),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<AboutContext>();

  if (!initial && data.isSuccess && !data.isFetching) setInitial(data.data);
  const [tab, setTab] = useState<AboutTab>(() => initialAboutTab(search));

  return (
    <div className="native-about">
      <PageHeader title={t("About Grocy")} />
      <Tabs
        ariaLabel={t("About Grocy")}
        tabs={[
          { id: "system-info", label: t("System info") },
          { id: "changelog", label: t("Changelog") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {!initial && !data.error ? <LoadingBlock label={t("Loading system info…")} /> : null}
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button type="button" className="btn" onClick={() => void data.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? (
        <>
          <TabPanel id="system-info" labelledBy="tab-system-info" hidden={tab !== "system-info"}>
            <SystemInformation info={initial.system_info} />
          </TabPanel>
          <TabPanel id="changelog" labelledBy="tab-changelog" hidden={tab !== "changelog"}>
            <div className="about-changelog">
              {[...initial.changelog.changelog_items]
                .sort((left, right) => right.release_number - left.release_number)
                .map((release) => (
                  <Release
                    key={release.release_number}
                    release={release}
                    newest={initial.changelog.newest_release_number}
                  />
                ))}
            </div>
          </TabPanel>
        </>
      ) : null}
      <p className="about-credits muted">
        <a href="https://grocy.info" target="_blank" rel="noopener noreferrer">
          Grocy
        </a>{" "}
        is a hobby project by{" "}
        <a href="https://berrnd.de" target="_blank" rel="noopener noreferrer">
          Bernd Bestel
        </a>
        <br />
        Created with passion since 2017
        <br />
        Life runs on Code
      </p>
    </div>
  );
}

function SystemInformation({ info }: { info: AboutContext["system_info"] }) {
  const { t } = useI18n();

  const values = [
    ["Version", info.grocy_version.Version],
    ["Released on", info.grocy_version.ReleaseDate],
    ["PHP Version", info.php_version],
    ["Python Version", info.python_version],
    ["SQLite Version", info.sqlite_version],
    ["Database Version", info.db_version],
    ["OS", info.os],
    ["Client", info.client],
  ];

  return (
    <>
      <table className="about-system-info">
        <caption className="sr-only">{t("System info")}</caption>
        <tbody>
          {values.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                <code>{value}</code>
                {label === "Released on" ? (
                  <RelativeDate date={info.grocy_version.ReleaseDate} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="about-thanks">
        {t("Do you find Grocy useful?")}
        <br />
        <a
          className="btn btn-primary btn-sm"
          href="https://grocy.info/#say-thanks"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Say thanks")}
        </a>
      </p>
    </>
  );
}

function RelativeDate({ date }: { date: string }) {
  const { t, locale } = useI18n();
  const [now] = useState(() => new Date());
  const formatted = tableDate(date, now, locale, t, { plain: true });

  return formatted.relative ? (
    <>
      {" "}
      <time className="stock-table-relative" dateTime={date}>
        {formatted.relative}
      </time>
    </>
  ) : null;
}

function Release({ release, newest }: { release: ChangelogRelease; newest: number }) {
  const [open, setOpen] = useState(release.release_number >= newest - 4);
  const id = useId();

  return (
    <article className="panel about-release">
      <h2>
        <button
          className="about-release-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          Version <strong>{release.version}</strong>
          <br /> Released on <strong>{release.release_date}</strong>
          <RelativeDate date={release.release_date} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="panel-inner">
        <RichText html={release.body_html} />
      </div>
    </article>
  );
}
