import { Link, useRouterState } from "@tanstack/react-router";

const links = [
  { to: "/", label: "Today" },
  { to: "/products", label: "Pantry" },
  { to: "/shopping", label: "Shopping" },
  { to: "/meal-plan", label: "Meals" },
  { to: "/recipes", label: "Recipes" },
  { to: "/household", label: "Household" },
  { to: "/equipment", label: "Equipment" },
  { to: "/calendar", label: "Calendar" },
  { to: "/manage", label: "Manage" },
  { to: "/reviews", label: "Review" },
  { to: "/settings", label: "Connection" },
] as const;

export function SiteNav() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  return (
    <nav className="site-nav" aria-label="Primary">
      {links.map(({ to, label }) => {
        const active =
          to === "/products"
            ? pathname === "/products" || pathname.startsWith("/products/")
            : to === "/recipes"
              ? pathname === "/recipes" || pathname.startsWith("/recipes/")
              : to === "/"
                ? pathname === "/"
                : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
