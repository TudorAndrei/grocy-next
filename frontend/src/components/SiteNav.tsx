import { useEffect, useId, useRef } from "react";
import { Link, useRouter, useRouterState, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { isNativePagePath, useFeatures, type Features } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { userentitiesQuery } from "@/lib/custom-data-lists";
import { compareSqliteBinary } from "@/lib/collation";
import { usePermissions } from "@/lib/permissions";
import type { JsonValue } from "@/lib/json";
import { useNativeDocumentReload } from "@/lib/native-document";
import { nativeResourceUrl } from "@/lib/native-userfields-clear";
import { useDialogState } from "@/hooks/useDialogState";
import { NativePageDialog } from "./NativePageDialog";
import { Icon, type IconName } from "./Icon";

/** Each domain keeps one marker colour across the nav and the Today board. */
export type Domain = "stock" | "shopping" | "home" | "agent" | "system";

type NavLink = {
  to: string;
  label: string;
  icon?: IconName;
  iconClass?: string;
  labelIsLiteral?: boolean;
  domain: Domain;
  match: (pathname: string) => boolean;
  count?: "today" | "shopping" | "review";
  permission?: string;
  authOnly?: boolean;
  feature?: string;
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
      {
        to: "/stockoverview",
        label: "Stock overview",
        icon: "stock",
        domain: "stock",
        match: (path) => path === "/stockoverview" || starts("/stock")(path),
      },
      {
        to: "/shoppinglist",
        label: "Shopping list",
        icon: "shopping",
        domain: "shopping",
        match: (path) => path === "/shoppinglist" || starts("/shopping")(path),
        count: "shopping",
      },
      {
        to: "/inventory",
        label: "Inventory",
        icon: "journal",
        domain: "stock",
        match: starts("/inventory"),
        permission: "STOCK_INVENTORY",
      },
      {
        to: "/recipes",
        label: "Recipes",
        permission: "RECIPES",
        icon: "recipes",
        domain: "stock",
        match: (path) =>
          starts("/recipes")(path) || starts("/recipe")(path) || path === "/recipessettings",
      },
    ],
  },
  {
    label: "Home",
    links: [
      {
        to: "/choresoverview",
        label: "Chores overview",
        icon: "chores",
        domain: "home",
        match: starts("/choresoverview"),
      },
      {
        to: "/tasks",
        label: "Tasks",
        icon: "tasks",
        domain: "home",
        match: starts("/tasks"),
      },
      {
        to: "/batteriesoverview",
        label: "Batteries overview",
        icon: "batteries",
        domain: "home",
        match: starts("/batteriesoverview"),
      },
      {
        to: "/choretracking",
        label: "Chore tracking",
        icon: "chores",
        domain: "home",
        match: starts("/choretracking"),
        permission: "CHORE_TRACK_EXECUTION",
      },
      {
        to: "/batterytracking",
        label: "Battery tracking",
        icon: "batteries",
        domain: "home",
        match: starts("/batterytracking"),
        permission: "BATTERIES_TRACK_CHARGE_CYCLE",
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
    label: "Master data",
    links: [
      {
        to: "/products",
        label: "Products",
        icon: "products",
        domain: "stock",
        match: starts("/products"),
      },
      { to: "/chores", label: "Chores", icon: "chores", domain: "home", match: starts("/chores") },
      {
        to: "/batteries",
        label: "Batteries",
        icon: "batteries",
        domain: "home",
        match: starts("/batteries"),
      },
      {
        to: "/taskcategories",
        label: "Task categories",
        icon: "tasks",
        domain: "home",
        match: (path) => path === "/taskcategories" || starts("/taskcategory")(path),
      },
      {
        to: "/userfields",
        label: "Userfields",
        icon: "manage",
        domain: "system",
        match: (path) => path === "/userfields" || path.startsWith("/userfield/"),
      },
      {
        to: "/userentities",
        label: "Userentities",
        icon: "manage",
        domain: "system",
        match: (path) => path === "/userentities" || path.startsWith("/userentity/"),
      },
      {
        to: "/locations",
        label: "Locations",
        icon: "locations",
        domain: "stock",
        match: starts("/location"),
      },
      {
        to: "/shoppinglocations",
        label: "Stores",
        icon: "shopping",
        domain: "stock",
        match: starts("/shoppinglocation"),
      },
      {
        to: "/quantityunits",
        label: "Quantity units",
        icon: "manage",
        domain: "stock",
        match: starts("/quantityunit"),
      },
      {
        to: "/productgroups",
        label: "Product groups",
        icon: "products",
        domain: "stock",
        match: starts("/productgroup"),
      },
    ],
  },
  {
    label: "Tools",
    links: [
      {
        to: "/purchase",
        label: "Purchase",
        icon: "plus",
        domain: "stock",
        match: starts("/purchase"),
        permission: "STOCK_PURCHASE",
      },
      {
        to: "/consume",
        label: "Consume",
        icon: "stock",
        domain: "stock",
        match: starts("/consume"),
        permission: "STOCK_CONSUME",
      },
      {
        to: "/transfer",
        label: "Transfer",
        icon: "stock",
        domain: "stock",
        match: starts("/transfer"),
        feature: "STOCK_LOCATION_TRACKING",
        permission: "STOCK_TRANSFER",
      },
      {
        to: "/barcode",
        label: "Barcode",
        icon: "barcode",
        domain: "stock",
        match: starts("/barcode"),
      },
      {
        to: "/stockbylocation",
        label: "Stock by location",
        icon: "locations",
        domain: "stock",
        match: starts("/stockbylocation"),
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
        to: "/mealplan",
        label: "Meal plan",
        permission: "RECIPES_MEALPLAN",
        icon: "meals",
        domain: "stock",
        match: (path) => starts("/meal-plan")(path) || path.startsWith("/mealplan"),
      },
      {
        to: "/calendar",
        label: "Calendar",
        icon: "calendar",
        domain: "home",
        match: starts("/calendar"),
        feature: "CALENDAR",
        permission: "CALENDAR",
      },
      {
        to: "/equipment",
        label: "Equipment",
        permission: "EQUIPMENT",
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
      {
        to: "/usersettings",
        label: "User settings",
        icon: "settings",
        domain: "system",
        match: starts("/usersettings"),
      },
      {
        to: "/stocksettings",
        label: "Stock settings",
        icon: "settings",
        domain: "stock",
        match: starts("/stocksettings"),
      },
      {
        to: "/shoppinglistsettings",
        label: "Shopping list settings",
        icon: "settings",
        domain: "shopping",
        match: starts("/shoppinglistsettings"),
        feature: "SHOPPINGLIST",
        permission: "SHOPPINGLIST",
      },
      {
        to: "/recipessettings",
        label: "Recipes settings",
        icon: "recipes",
        domain: "stock",
        match: starts("/recipessettings"),
        permission: "RECIPES",
      },
      {
        to: "/choressettings",
        label: "Chores settings",
        icon: "chores",
        domain: "home",
        match: starts("/choressettings"),
        permission: "CHORES",
      },
      {
        to: "/taskssettings",
        label: "Tasks settings",
        icon: "tasks",
        domain: "home",
        match: starts("/taskssettings"),
        permission: "TASKS",
      },
      {
        to: "/batteriessettings",
        label: "Batteries settings",
        icon: "batteries",
        domain: "home",
        match: starts("/batteriessettings"),
        permission: "BATTERIES",
      },
      {
        to: "/users",
        label: "Manage users",
        icon: "manage",
        domain: "system",
        match: (path) => starts("/users")(path) || starts("/user")(path),
        permission: "USERS_READ",
      },
      {
        to: "/manageapikeys",
        label: "Manage API keys",
        icon: "settings",
        domain: "system",
        match: starts("/manageapikeys"),
        authOnly: true,
      },
      {
        to: "/api",
        label: "REST API browser",
        icon: "settings",
        domain: "system",
        match: starts("/api"),
      },
      {
        to: "/barcodescannertesting",
        label: "Barcode scanner testing",
        icon: "barcode",
        domain: "system",
        match: starts("/barcodescannertesting"),
      },
      {
        to: "/about",
        label: "About Grocy",
        icon: "settings",
        domain: "system",
        match: starts("/about"),
      },
    ],
  },
];

export function navLinkVisible(
  link: NavLink,
  features: Features,
  disableAuth: JsonValue | undefined,
) {
  return (
    features.routeEnabled(link.to) &&
    (!link.feature || features.enabled(link.feature)) &&
    (!link.authOnly || !disableAuth || disableAuth === "0")
  );
}

export function useNavCounts() {
  const features = useFeatures();
  const allowed = usePermissions();
  const canReview = features.enabled("STOCK") && allowed("STOCK");

  const shopping = useQuery({
    queryKey: queryKeys.shopping(1),
    queryFn: () => api.getShoppingList(1),
    enabled: features.enabled("SHOPPINGLIST"),
  });

  const proposals = useQuery({
    queryKey: queryKeys.proposalsPending,
    queryFn: api.listPendingProposals,
    enabled: canReview,
  });

  return {
    shopping: features.enabled("SHOPPINGLIST")
      ? (shopping.data?.items.filter((item) => !item.done).length ?? 0)
      : 0,
    review: canReview ? (proposals.data?.length ?? 0) : 0,
  };
}

export function usePathname() {
  return useRouterState({ select: (s) => s.location.pathname });
}

export function SiteNav({
  masterOpen,
  onMasterToggle,
  onNavigate,
}: {
  masterOpen: boolean;
  onMasterToggle: () => void;
  onNavigate?: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const activeChecked = useRef(false);
  const masterId = useId();
  const about = useDialogState<string>();
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload();
  const { t } = useI18n();
  const features = useFeatures();
  const allowed = usePermissions();
  const disableAuth = features.query.data?.DISABLE_AUTH;
  const pathname = usePathname();
  const returnto = useLocation({ select: (location) => location.href.split("?")[0] });
  const counts = useNavCounts();
  const userentities = useQuery(userentitiesQuery);

  const customLinks: NavLink[] = (userentities.data ?? [])
    .flatMap((entity) => (entity.show_in_sidebar_menu === 1 ? [entity] : []))
    .sort((first, second) => compareSqliteBinary(first.name, second.name))
    .map<NavLink>((entity) => ({
      to: "/userobjects/" + encodeURIComponent(entity.name),
      label: entity.caption,
      labelIsLiteral: true,
      icon: entity.icon_css_class?.trim() ? undefined : "manage",
      iconClass: entity.icon_css_class ?? "",
      domain: "home",
      match: starts("/userobjects/" + encodeURIComponent(entity.name)),
    }));

  const customGroup: NavGroup = { label: "Custom entities", links: customLinks };

  const groups = NAV_GROUPS.flatMap((group) =>
    group.label === "Master data" && customLinks.length ? [customGroup, group] : [group],
  );

  const renderLink = (link: NavLink) => {
    const count = link.count && link.count !== "today" ? counts[link.count] : 0;
    const active = link.match(pathname);
    const label = link.labelIsLiteral ? link.label : t(link.label);
    const disabled = !!link.permission && !allowed(link.permission);
    const permissionOnLink = link.to.endsWith("settings") || link.to === "/users";

    const permissionClass = link.permission
      ? `permission-${link.permission}${disabled ? " disabled not-allowed" : ""}`
      : undefined;

    const content = (
      <>
        {link.icon ? (
          <Icon name={link.icon} />
        ) : (
          <i className={"fa-fw " + (link.iconClass ?? "")} aria-hidden="true" />
        )}
        <span className="nav-link-label">{label}</span>
        {count > 0 ? <em aria-label={t("%s open", String(count))}>{count}</em> : null}
      </>
    );

    const anchor =
      link.to === "/about" ? (
        <a
          key={link.to}
          href={nativeResourceUrl("/about?embedded", features.query.data)}
          className="discrete-link show-as-dialog-link"
          data-dialog-type="wider"
          data-domain={link.domain}
          title={label}
          aria-current={active ? "page" : undefined}
          onClick={(event) => {
            // The native delegated handler intercepts delivered clicks, including modifiers.
            event.preventDefault();
            about.open(event.currentTarget.href);
          }}
        >
          {content}
        </a>
      ) : (
        <Link
          key={link.to}
          to={link.to}
          target={link.to === "/api" ? "_blank" : undefined}
          className={permissionOnLink ? permissionClass : undefined}
          aria-disabled={disabled || undefined}
          title={label}
          search={link.to === "/usersettings" ? { returnto } : undefined}
          data-domain={link.domain}
          aria-current={active ? "page" : undefined}
          onClick={(event) => {
            if (
              !event.defaultPrevented &&
              event.button === 0 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !event.altKey &&
              link.to !== "/api" &&
              link.to === pathname &&
              reloadDocument()
            ) {
              // Navigation targets the anchor, even when router search
              // normalization considers an empty '?' unchanged.
              const target = new URL(event.currentTarget.href);
              router.history.replace(target.href.slice(target.origin.length));
              event.preventDefault();
            }

            onNavigate?.();
          }}
        >
          {content}
        </Link>
      );

    return link.permission && !permissionOnLink ? (
      <div key={link.to} className={permissionClass}>
        {anchor}
      </div>
    ) : (
      anchor
    );
  };

  useEffect(() => {
    if (activeChecked.current || !isNativePagePath(pathname)) return;

    const active = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');

    // A custom-entity link can arrive after the first shell render.
    if (!active) return;

    activeChecked.current = true;

    const rail = nav.current?.closest<HTMLElement>(".site-rail");
    const rect = active.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();

    if (!rect.height || !rect.width || !railRect?.height || !railRect.width) return;

    if (railRect.right <= 0 || railRect.left >= window.innerWidth) return;

    const top = Math.max(-75, railRect.top);
    const bottom = Math.min(window.innerHeight - 75, railRect.bottom);

    if (rect.bottom <= top || rect.top >= bottom) active.scrollIntoView?.({ block: "nearest" });
  }, [pathname, userentities.data]);

  const fontBase = import.meta.env.BASE_URL.replace(/\/+$/, "") + "/vendor/fontawesome/css/";
  const openedAbout = about.state;

  return (
    <>
      <nav ref={nav} className="site-nav" aria-label={t("Primary")}>
        {customLinks.length
          ? ["fontawesome", "solid", "regular", "brands"].map((name) => (
              <link key={name} rel="stylesheet" href={fontBase + name + ".min.css"} />
            ))
          : null}
        {groups.flatMap((group, index) => {
          const links = group.links.filter((link) => navLinkVisible(link, features, disableAuth));

          if (links.length === 0) return [];

          return [
            <div key={group.label ?? index} className="nav-group">
              {group.label === "Master data" ? (
                <button
                  type="button"
                  className="nav-master-toggle"
                  aria-label={t("Manage master data")}
                  title={t("Manage master data")}
                  aria-expanded={masterOpen}
                  aria-controls={masterId}
                  onClick={onMasterToggle}
                >
                  <Icon name="manage" />
                  <span className="nav-link-label">{t("Manage master data")}</span>
                  <Icon name={masterOpen ? "up" : "down"} />
                </button>
              ) : group.label ? (
                <div className="nav-group-label">{t(group.label)}</div>
              ) : null}
              {group.label === "Master data" ? (
                <div id={masterId} className="nav-master-links" hidden={!masterOpen}>
                  {links.map(renderLink)}
                </div>
              ) : (
                links.map(renderLink)
              )}
            </div>,
          ];
        })}
      </nav>
      {openedAbout ? (
        <NativePageDialog
          key={openedAbout.id}
          url={openedAbout.value}
          dialogType="wider"
          onClose={() => about.close(openedAbout.id)}
        />
      ) : null}
    </>
  );
}
