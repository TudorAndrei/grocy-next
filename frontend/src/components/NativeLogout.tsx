import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { nativeLoginQuery } from "@/lib/native-auth";

export function NativeLoginRedirect() {
  const { t } = useI18n();
  const context = useQuery(nativeLoginQuery());
  const router = useRouter();

  const href =
    context.isSuccess && context.isFetchedAfterMount ? context.data.login_url : undefined;

  useEffect(() => {
    if (!href) return;
    const target = new URL(href, window.location.href);

    // The server owns this URL; route generation would remove a visible script alias.
    if (target.origin === window.location.origin)
      router.history.replace(target.pathname + target.search + target.hash);
    else window.location.replace(target.href);
  }, [href, router]);

  return (
    <main id="main-content" className="setup-page">
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock />
      )}
    </main>
  );
}

/** SPA callers cross the same native server boundary as a document navigation. */
export function NativeLogout() {
  const { t } = useI18n();
  const context = useQuery(nativeLoginQuery());

  const href =
    context.isSuccess && context.isFetchedAfterMount ? context.data.logout_url : undefined;

  useEffect(() => {
    if (href) window.location.replace(href);
  }, [href]);

  return (
    <main id="main-content" className="setup-page">
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : (
        <LoadingBlock label={t("Signing out…")} />
      )}
    </main>
  );
}
