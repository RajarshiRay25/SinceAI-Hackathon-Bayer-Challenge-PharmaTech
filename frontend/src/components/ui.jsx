// Small shared building blocks.
import { useCountUp, useIndicator } from "../lib/motion.js";

/** Soft blue-tinted elevation shared by cards and tiles. */
export const ELEVATE =
  "shadow-[0_1px_2px_rgb(30_64_175/0.05),0_10px_30px_-18px_rgb(30_64_175/0.28)] hover:shadow-[0_2px_4px_rgb(30_64_175/0.06),0_18px_40px_-18px_rgb(30_64_175/0.4)]";

export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section
      className={`min-w-0 animate-rise rounded-2xl border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-300 hover:border-line-strong sm:p-5 ${ELEVATE} ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 border-l-[3px] border-accent pl-2.5" style={{ borderImage: "linear-gradient(var(--accent), var(--accent-2)) 1" }}>
            <h2 className="text-[15px] font-bold text-ink">{title}</h2>
            {subtitle && <p key={subtitle} className="mt-0.5 animate-fade-in text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Highlight that slides between options instead of jumping. */
export function SlidingPill({ box, className = "bg-surface shadow-sm ring-1 ring-accent/15" }) {
  if (!box) return null;
  return (
    <span
      aria-hidden="true"
      className={`absolute rounded-md transition-all duration-300 ease-out-soft ${className}`}
      style={{ left: box.left, width: box.width, top: box.top, height: box.height }}
    />
  );
}

/** Two-to-four option toggle, e.g. Tests | Positivity */
export function Segmented({ options, value, onChange, label }) {
  const [ref, box] = useIndicator(value);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className="relative inline-flex rounded-lg border border-line bg-bg p-0.5">
      <SlidingPill box={box} />
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-md px-3 py-1 text-[13px] font-semibold transition-colors ${
            value === o.value ? "text-accent" : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] leading-5 transition-all duration-200 active:scale-95 ${
        active
          ? "border-transparent bg-linear-to-r from-accent to-accent-2 text-white shadow-[0_4px_12px_-4px_var(--accent)]"
          : "border-line-strong bg-surface text-ink-2 hover:-translate-y-px hover:border-accent hover:bg-accent-soft hover:text-accent"
      }`}
    >
      {active && (
        <svg viewBox="0 0 12 12" className="-ml-1 h-3 w-3 animate-pop" aria-hidden="true">
          <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {children}
    </button>
  );
}

/**
 * Legend. Pass `hidden` (array of labels) and `onToggle` to make each key a show/hide button,
 * and `onHover` to highlight a series in the chart while the pointer is on its key.
 */
export function Legend({ items, hidden = [], onToggle, onHover }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {items.map((i) => {
        const off = hidden.includes(i.label);
        const swatch = <i className="inline-block h-2.5 w-2.5 rounded-sm transition-opacity" style={{ background: i.color, opacity: off ? 0.25 : 1 }} />;
        return onToggle ? (
          <button
            key={i.label}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(i.label)}
            onMouseEnter={() => onHover?.(i.label)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(i.label)}
            onBlur={() => onHover?.(null)}
            className={`-mx-1 inline-flex items-center gap-1.5 rounded px-1 transition-colors hover:bg-bg ${off ? "text-ink-3 line-through" : ""}`}
          >
            {swatch}
            {i.label}
          </button>
        ) : (
          <span key={i.label} className="inline-flex items-center gap-1.5">
            {swatch}
            {i.label}
          </span>
        );
      })}
    </div>
  );
}

export function Hint({ children }) {
  return <p className="mt-2 text-[12px] text-ink-3">{children}</p>;
}

/** Dark tooltip box used by every chart. A row may carry a third item: the series colour, drawn as a line key. */
export function TipBox({ title, rows }) {
  return (
    <div className="max-w-64 animate-fade-in rounded-lg bg-ink px-3 py-2 text-[12.5px] leading-relaxed text-bg shadow-lg">
      <div className="font-bold">{title}</div>
      {rows.map(([k, v, color]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 opacity-75">
            {color && <i className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />}
            {k}
          </span>
          <span className="num">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** A number that counts to its new value when it changes. */
export function AnimatedNumber({ value, format, duration }) {
  const v = useCountUp(value, duration);
  return <>{format(v)}</>;
}
