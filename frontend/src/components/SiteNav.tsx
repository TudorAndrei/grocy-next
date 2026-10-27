import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { Icon, type IconName } from "./Icon";

/** Each domain keeps one marker colour across the nav and the Today board. */
export type Domain = "stock" | "shopping" | "home" | "agent" | "system";

type NavLink = {
  to: string;
  label: string;
  icon: IconName;
  domain: Domain;
  match: (pathname: string) => boolean;
  count?: "today" | "shopping" | "review";
};

type NavGroup = { label: string | null; links: NavLink[] };

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    links: [
      {
        to: "/today",
        label: "Today",
        icon: "today",
        domain: "stock",
        match: (p) => p === "/today",
      },
    ],
  },
  {
    label: "Kitchen",
    links: [
      { to: "/stock", label: "Stock", icon: "stock", domain: "stock", match: starts("/stock") },
      {
        to: "/shopping",
        label: "Shopping",
        icon: "shopping",
        domain: "shopping",
        match: starts("/shopping"),
        count: "shopping",
      },
      {
        to: "/products",
        label: "Products",
        icon: "products",
        domain: "stock",
        match: starts("/products"),
      },
      {
        to: "/recipes",
        label: "Recipes",
        icon: "recipes",
        domain: "stock",
        match: starts("/recipes"),
      },
    ],
  },
  {
    label: "Home",
    links: [
      { to: "/chores", label: "Chores", icon: "chores", domain: "home", match: starts("/chores") },
      { to: "/tasks", label: "Tasks", icon: "tasks", domain: "home", match: starts("/tasks") },
      {
        to: "/batteries",
        label: "Batteries",
        icon: "batteries",
        domain: "home",
        match: starts("/batteries"),
      },
      {
        to: "/household",
        label: "Household log",
        icon: "household",
        domain: "home",
        match: starts("/household"),
      },
    ],
  },
  {
    label: "Tools",
    links: [
      {
        to: "/barcode",
        label: "Barcode",
        icon: "barcode",
        domain: "stock",
        match: starts("/barcode"),
      },
      {
        to: "/locations",
        label: "Locations",
        icon: "locations",
        domain: "stock",
        match: starts("/locations"),
      },
      {
        to: "/journal",
        label: "Journal",
        icon: "journal",
        domain: "stock",
        match: starts("/journal"),
      },
      {
        to: "/labels",
        label: "Labels",
        icon: "labels",
        domain: "system",
        match: starts("/labels"),
      },
    ],
  },
  {
    label: "Planning",
    links: [
      {
        to: "/meal-plan",
        label: "Meals",
        icon: "meals",
        domain: "stock",
        match: starts("/meal-plan"),
      },
      {
        to: "/calendar",
        label: "Calendar",
        icon: "calendar",
        domain: "home",
        match: starts("/calendar"),
      },
      {
        to: "/equipment",
        label: "Equipment",
        icon: "equipment",
        domain: "home",
        match: starts("/equipment"),
      },
      {
        to: "/manage",
        label: "Manage",
        icon: "manage",
        domain: "system",
        match: starts("/manage"),
      },
    ],
  },
  {
    label: "Agent",
    links: [
      {
        to: "/reviews",
        label: "Review",
        icon: "review",
        domain: "agent",
        match: starts("/reviews"),
        count: "review",
      },
      {
        to: "/activity",
        label: "Activity",
        icon: "activity",
        domain: "agent",
        match: starts("/activity"),
      },
      {
        to: "/settings",
        label: "Settings",
        icon: "settings",
        domain: "system",
        match: starts("/settings"),
      },
    ],
  },
];

export function useNavCounts() {
  const features = useFeatures();

  const shopping = useQuery({
    queryKey: queryKeys.shopping(1),
    queryFn: () => api.getShoppingList(1),
    enabled: features.enabled("SHOPPINGLIST"),
  });

  const proposals = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: api.listPendingProposals,
    enabled: features.enabled("STOCK"),
  });

  return {
    shopping: features.enabled("SHOPPINGLIST")
      ? (shopping.data?.items.filter((item) => !item.done).length ?? 0)
      : 0,
    review: features.enabled("STOCK") ? (proposals.data?.length ?? 0) : 0,
  };
}

export function usePathname() {
  return useRouterState({ select: (s) => s.location.pathname });
}

export function SiteNav({ onNavigate }: { onNavigate?: () => void }) {
  const features = useFeatures();
  const pathname = usePathname();
  const counts = useNavCounts();

  return (
    <nav className="site-nav" aria-label="Primary">
      {NAV_GROUPS.flatMap((group, index) => {
        const links = group.links.filter((link) => features.routeEnabled(link.to));

        if (links.length === 0) return [];

        return [
          <div key={group.label ?? index} className="nav-group">
            {group.label ? <div className="nav-group-label">{group.label}</div> : null}
            {links.map((link) => {
              const count = link.count && link.count !== "today" ? counts[link.count] : 0;
              const active = link.match(pathname);

              return (
                <Link
                  key={link.to}
                  to={link.to}
                  data-domain={link.domain}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon name={link.icon} />
                  <span>{link.label}</span>
                  {count > 0 ? <em aria-label={`${count} open`}>{count}</em> : null}
                </Link>
              );
            })}
          </div>,
        ];
      })}
    </nav>
  );
}
