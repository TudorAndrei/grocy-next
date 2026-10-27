import { Link, Outlet } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { usePathname } from "./SiteNav";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";

export function FeatureRoute() {
  const pathname = usePathname();
  const features = useFeatures();

  if (pathname === "/settings") return <Outlet />;

  if (features.query.isPending) return <LoadingBlock label="Loading configuration…" />;

  if (features.query.isError) {
    return (
      <>
        <ErrorBlock message={features.query.error.message} />
        <button type="button" className="btn" onClick={() => void features.query.refetch()}>
          Try again
        </button>
      </>
    );
  }

  if (!features.routeEnabled(pathname)) {
    return (
      <>
        <PageHeader
          title="Feature disabled"
          lead="The server configuration has disabled this feature."
        />
        <Link to="/today" className="btn">
          Go to Today
        </Link>
      </>
    );
  }

  return <Outlet />;
}
