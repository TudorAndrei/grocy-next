import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

type NavLink = {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
  icon: ReactNode;
};

type NavGroup = {
  label: string;
  links: NavLink[];
};

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const groups: NavGroup[] = [
  {
    label: "Kitchen",
    links: [
      {
        to: "/stock",
        label: "Stock",
        match: (p) => p === "/stock" || p === "/",
        icon: (
          <svg {...iconProps}>
            <path d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
            <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          </svg>
        ),
      },
      {
        to: "/shopping",
        label: "Shopping",
        match: (p) => p.startsWith("/shopping"),
        icon: (
          <svg {...iconProps}>
            <path d="M6 7h15l-1.4 8.2a2 2 0 0 1-2 1.6H9a2 2 0 0 1-2-1.5L5 3H2" />
            <circle cx="10" cy="20" r="1" />
            <circle cx="17" cy="20" r="1" />
          </svg>
        ),
      },
      {
        to: "/products",
        label: "Products",
        match: (p) => p === "/products" || p.startsWith("/products/"),
        icon: (
          <svg {...iconProps}>
            <path d="M4 9.5 12 4l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z" />
            <path d="M9 21v-7h6v7" />
          </svg>
        ),
      },
      {
        to: "/recipes",
        label: "Recipes",
        match: (p) => p === "/recipes" || p.startsWith("/recipes/"),
        icon: (
          <svg {...iconProps}>
            <path d="M6 3h9a3 3 0 0 1 3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <path d="M9 8h6M9 12h6M9 16h4" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Home",
    links: [
      {
        to: "/household",
        label: "Household",
        match: (p) => p.startsWith("/household"),
        icon: (
          <svg {...iconProps}>
            <path d="M4 11.5 12 4l8 7.5" />
            <path d="M6 10.5V20h12v-9.5" />
          </svg>
        ),
      },
      {
        to: "/reviews",
        label: "Review",
        match: (p) => p.startsWith("/reviews"),
        icon: (
          <svg {...iconProps}>
            <path d="M9 11.5 11 13.5 15.5 9" />
            <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
          </svg>
        ),
      },
      {
        to: "/settings",
        label: "Settings",
        match: (p) => p.startsWith("/settings"),
        icon: (
          <svg {...iconProps}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        ),
      },
    ],
  },
];

export function SiteNav() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  return (
    <nav className="site-nav" aria-label="Primary">
      {groups.map((group) => (
        <div key={group.label} className="nav-group">
          <div className="nav-group-label">{group.label}</div>
          {group.links.map(({ to, label, match, icon }) => (
            <Link key={to} to={to} data-active={match(pathname) ? "true" : "false"}>
              {icon}
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
