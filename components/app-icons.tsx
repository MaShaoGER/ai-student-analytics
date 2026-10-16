import type { ReactNode } from "react";

export type IconName =
  | "sun"
  | "moon"
  | "messages"
  | "dashboard"
  | "database"
  | "sparkles"
  | "settings"
  | "chart"
  | "line"
  | "pie"
  | "treemap"
  | "radar"
  | "scatter"
  | "arrow"
  | "arrowUpRight"
  | "arrowLeft"
  | "chevron"
  | "search"
  | "upload"
  | "download"
  | "shield"
  | "check"
  | "clock"
  | "logout"
  | "eye"
  | "eyeOff"
  | "users"
  | "sliders"
  | "link"
  | "lock"
  | "book"
  | "activity"
  | "calendar"
  | "info"
  | "close"
  | "menu"
  | "file"
  | "mail"
  | "plus"
  | "refresh";

const shapes: Record<IconName, ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />,
  messages: (
    <>
      <path d="M4 3h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7l-5 3V5a2 2 0 0 1 2-2Z" />
      <path d="M8 19h9l5 3V9" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 2v4M18 4h4" />
    </>
  ),
  settings: (
    <>
      <path d="m9.5 3-.8 2.1-2 .9-2.1-.4-2.1 3.6L4 10.8v2.4l-1.5 1.6 2.1 3.6 2.1-.4 2 .9.8 2.1h5l.8-2.1 2-.9 2.1.4 2.1-3.6-1.5-1.6v-2.4l1.5-1.6-2.1-3.6-2.1.4-2-.9L14.5 3h-5Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 17v-6M12 17V7M17 17v-9" />
    </>
  ),
  line: <path d="M3 3v18h18M6 16l5-7 5 3 5-7" />,
  pie: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9Z" />
      <path d="M15 3.5V9h5.5A9 9 0 0 0 15 3.5Z" />
    </>
  ),
  treemap: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M11 3v18m0-10h10m-5 0v10" />
    </>
  ),
  radar: (
    <>
      <path d="m12 3 9 7-3.5 10h-11L3 10Z" />
      <path d="m12 7 5 4-2 6H9l-2-6Zm0-4v4m9 3-4 1m.5 9L15 17m-8.5 3L9 17M3 10l4 1" />
    </>
  ),
  scatter: (
    <>
      <path d="M3 3v18h18" />
      <circle cx="8" cy="15" r="2" />
      <circle cx="14" cy="9" r="3" />
      <circle cx="20" cy="5" r="1" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  arrowUpRight: <path d="M5 19 19 5M5 5h14v14" />,
  arrowLeft: <path d="M20 12H4m6-6-6 6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 4-3.2 7-8 9-4.8-2-8-5-8-9V6l8-3Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18M9.5 5.3A12 12 0 0 1 12 5c6.5 0 10 7 10 7a21 21 0 0 1-3.4 4.4M6.3 6.3A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.2-1.2M10 10a3 3 0 0 0 4 4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h7m6 0h3M4 12h2m6 0h8M4 18h10m6 0h0" />
      <circle cx="14" cy="6" r="3" />
      <circle cx="9" cy="12" r="3" />
      <circle cx="17" cy="18" r="3" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 13 4-4M8 16l-1 1a4.2 4.2 0 0 1-6-6l5-5a4.2 4.2 0 0 1 6 0m0 2 1-1a4.2 4.2 0 0 1 6 6l-5 5a4.2 4.2 0 0 1-6 0"
        transform="translate(2 1)"
      />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v16M3 4h4a6 6 0 0 1 5 2 6 6 0 0 1 5-2h4v15h-4a6 6 0 0 0-5 2 6 6 0 0 0-5-2H3V4Z" />
    </>
  ),
  activity: <path d="M2 12h4l3-8 6 16 3-8h4" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  file: (
    <>
      <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={["app-icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  );
}
