import type { ReactNode } from "react";
import { t } from "@/i18n";

export function Panel({ eyebrow, title, actions, children, className = "", footer }: { eyebrow?: ReactNode; title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={`panel flex flex-col gap-3 p-5 ${className}`}>
      {(eyebrow || title || actions) && (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2 className="title">{title}</h2>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="src">{footer}</footer>}
    </section>
  );
}

export function Segmented<T extends string>({ value, items, onChange, label }: { value: T; items: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((i) => (
        <button key={i.value} type="button" aria-pressed={value === i.value} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} aria-label={t("state.loading")} />;
}

export function ErrorBox({ error }: { error: Error }) {
  return (
    <div role="alert" className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--line-2)", color: "var(--text-2)" }}>
      {t("state.error")} <span className="src">{error.message}</span>
    </div>
  );
}

const PATHS = {
  chevron: "m6 9 6 6 6-6",
  up: "m6 15 6-6 6 6",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  reset: "M5 7v5h5M6.1 16a7 7 0 1 0 .2-8.2L5 9",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  collapse: "M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7",
  check: "m5 12 5 5 9-10",
  globe: "M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  moon: "M20 15.5A8.2 8.2 0 0 1 8.5 4 8.3 8.3 0 1 0 20 15.5Z",
  sun: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M5 20h14",
  search: "m16 16 4.5 4.5",
  close: "m7 7 10 10M17 7 7 17",
  info: "M12 11v6M12 7.5v.1",
  calendar: "M4 10h16M8 3v4M16 3v4",
};

export function Icon({ name, size = 16, stroke = 2 }: { name: keyof typeof PATHS; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "globe" && <circle cx="12" cy="12" r="9" />}
      {name === "sun" && <circle cx="12" cy="12" r="4" />}
      {name === "search" && <circle cx="10.5" cy="10.5" r="6.5" />}
      {name === "info" && <circle cx="12" cy="12" r="9" />}
      {name === "calendar" && <rect x="4" y="5" width="16" height="15" rx="2" />}
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="12" width="5" height="11" rx="1.5" fill="#F2B45A" />
      <rect x="10.5" y="6" width="5" height="17" rx="1.5" fill="#EE7A35" />
      <rect x="18" y="2" width="5" height="21" rx="1.5" fill="#C9361F" />
    </svg>
  );
}
