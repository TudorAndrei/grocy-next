import { Link, useRouterState } from "@tanstack/react-router";

const links = [
  { to: "/products", label: "Pantry" },
  { to: "/recipes", label: "Recipes" },
  { to: "/household", label: "Household" },
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
              : pathname.startsWith(to);
        return (
          <Link key={to} to={to} data-active={active ? "true" : "false"}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
