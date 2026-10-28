import { useI18n } from "@/lib/i18n";
import { Link, Outlet } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { usePathname } from "./SiteNav";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";

export function FeatureRoute() {
  const { t: tr } = useI18n();

  const pathname = usePathname();
  const features = useFeatures();

  if (pathname === "/settings") return <Outlet />;

  if (features.query.isPending) return <LoadingBlock label={tr("Loading configuration…")} />;

  if (features.query.isError) {
    return (
      <>
        <ErrorBlock message={features.query.error.message} />
        <button type="button" className="btn" onClick={() => void features.query.refetch()}>
          {tr("Try again")}
        </button>
      </>
    );
  }

  if (!features.routeEnabled(pathname)) {
    return (
      <>
        <PageHeader
          title={tr("Feature disabled")}
          lead={tr("The server configuration has disabled this feature.")}
        />
        <Link to="/today" className="btn">
          {tr("Go to Today")}
        </Link>
      </>
    );
  }

  return <Outlet />;
}
