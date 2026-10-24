const PATHS = {
  today: ["M4 5h16v15H4z", "M4 9h16", "M8 3v4M16 3v4", "M8 13h3v3H8z"],
  stock: ["M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z", "M5 5h14v3H5z", "M10 12h4"],
  shopping: ["M6 7h15l-1.4 8.2a2 2 0 0 1-2 1.6H9a2 2 0 0 1-2-1.5L5 3H2", "M10 20h.01M17 20h.01"],
  products: ["M4 7h16", "M4 12h16", "M4 17h10"],
  recipes: ["M6 3h9a3 3 0 0 1 3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M9 8h6M9 12h6M9 16h4"],
  chores: ["M4 11.5 12 4l8 7.5", "M6 10.5V20h12v-9.5", "M10 20v-5h4v5"],
  tasks: [
    "M9 6h11M9 12h11M9 18h11",
    "m3 6 1.5 1.5L7 5",
    "m3 12 1.5 1.5L7 11",
    "m3 18 1.5 1.5L7 17",
  ],
  batteries: ["M3 8h15v8H3z", "M21 11v2", "M6 11h5v2H6z"],
  review: ["M9 11.5 11 13.5 15.5 9", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"],
  activity: ["M3 12h4l3-7 4 14 3-7h4"],
  settings: [
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  ],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m20 20-4-4"],
  plus: ["M12 5v14M5 12h14"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["M6 6l12 12M18 6 6 18"],
  back: ["M15 5l-7 7 7 7"],
  agent: ["M5 8h14v10H5z", "M12 4v4", "M9 13h.01M15 13h.01"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
