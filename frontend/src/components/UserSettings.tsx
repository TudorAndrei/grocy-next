import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import { nativeSettingsReturnHref } from "@/lib/native-settings-context";
import type { UserSettings as Settings } from "@/lib/types";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function UserSettings({ search }: { search: string }) {
  const { t, ready, localizationError, retryLocalization } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const [initial, setInitial] = useState<Settings>();

  if (!initial && settings.isSuccess && !settings.isFetching && ready) setInitial(settings.data);
  const error = settings.error ?? (!initial ? localizationError : null);

  return (
    <>
      <PageHeader title={t("User settings")} />
      {!initial && !error ? <LoadingBlock label={t("Loading preferences…")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (localizationError) retryLocalization();

              if (settings.error) void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? <LanguageControl settings={initial} search={search} /> : null}
    </>
  );
}

function LanguageControl({ settings, search }: { settings: Settings; search: string }) {
  const { t, languages } = useI18n();
  const client = useQueryClient();
  const router = useRouter();
  const save = useNativePreferenceAutosave(settings);
  const [value, setValue] = useState(String(settings.locale ?? ""));
  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (value && !languages.includes(value) && select.current) select.current.selectedIndex = -1;
  });
  const root = router.buildLocation({ to: "/" }).publicHref;
  const href = nativeSettingsReturnHref(search, root);

  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    void client.invalidateQueries({ queryKey: queryKeys.userSettings, refetchType: "none" });
    void router.navigate({ href });
  };

  return (
    <section className="panel panel-inner native-settings" aria-label={t("User settings")}>
      <label className="field">
        {t("Language")}
        <select
          ref={select}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            save("locale", event.target.value);
          }}
        >
          <option value="">{t("Default")}</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {t(language)}
            </option>
          ))}
        </select>
      </label>
      <a className="btn btn-primary" href={href} onClick={navigate}>
        {t("OK")}
      </a>
    </section>
  );
}
