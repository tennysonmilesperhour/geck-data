// Dark surface wrapper with an optional header row. Use as the default
// container for dashboard sections to keep the aesthetic consistent.
import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  right,
  children,
  padded = true,
  tone = "card",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  tone?: "card" | "soft";
}) {
  const base = tone === "soft" ? "surface-soft" : "surface";
  return (
    <section className={`${base} shadow-panel`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-700/70 px-4 py-3">
          <div>
            {title ? (
              <h2 className="text-[13px] font-semibold tracking-tight text-ink-50">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>
            ) : null}
          </div>
          {right ? <div className="shrink-0 text-xs text-ink-400">{right}</div> : null}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink-50">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p>
        ) : null}
      </div>
      {right ? <div className="text-xs text-ink-400">{right}</div> : null}
    </div>
  );
}

export function StatusPill({
  status = "ready",
  label,
}: {
  status?: "ready" | "busy" | "idle" | "info";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300">
      <span className={`status-dot ${status}`} />
      {label}
    </span>
  );
}
