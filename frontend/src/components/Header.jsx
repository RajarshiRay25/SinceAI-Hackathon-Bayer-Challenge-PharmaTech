import { useEffect, useState } from "react";
import { SlidingPill } from "./ui.jsx";
import { useIndicator } from "../lib/motion.js";

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

const TABS = [
  { id: "overview", label: "Overview", short: "Overview",
    icon: <path {...icon} d="M3 16.5h14M5.5 13.5v-4M10 13.5v-8M14.5 13.5v-6" /> },
  { id: "conditions", label: "Conditions & exposure", short: "Conditions",
    icon: <path {...icon} d="M10 16.5s-6-3.6-6-8.2A3.3 3.3 0 0 1 10 6.4a3.3 3.3 0 0 1 6 1.9c0 4.6-6 8.2-6 8.2Z" /> },
  { id: "quality", label: "Data quality", short: "Quality",
    icon: <path {...icon} d="M10 3 4.5 5v4.6c0 3.4 2.4 5.9 5.5 7.4 3.1-1.5 5.5-4 5.5-7.4V5L10 3Zm-2.3 7 1.6 1.6 3-3.1" /> },
  { id: "whatif", label: "What-if explorer", short: "What-if",
    icon: <path {...icon} d="M5 5.5a2 2 0 1 0 0 .01M15 5.5a2 2 0 1 0 0 .01M10 15a2 2 0 1 0 0 .01M6.6 7l2.4 6M13.4 7 11 13M7 5.5h6" /> },
  { id: "about", label: "About us", short: "About",
    icon: <path {...icon} d="M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4.5 7a4.5 4.5 0 0 1 9 0M13.5 9a2 2 0 1 0 0-4M14.5 12a3.8 3.8 0 0 1 3 4" /> },
];

/** True once the page has scrolled past a few pixels; the header compacts. */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(() => scrollY > threshold);
  useEffect(() => {
    const on = () => setScrolled(scrollY > threshold);
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

function Logo({ loading }) {
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_6px_20px_-6px_rgb(0_0_0/0.45)] ring-1 ring-white/60 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <defs>
          <linearGradient id="logo-ink" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--hero-2)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        {/* the pulse line draws itself on load and keeps tracing while new numbers load */}
        <path d="M2 13h4l2.2-6 3.6 11 2.5-7 1.5 2H22" fill="none" stroke="url(#logo-ink)"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={loading ? "14 10" : "48"}
          className={loading ? "animate-trace" : "animate-draw"} />
      </svg>
      <span className="absolute -right-1 -top-1 flex h-3 w-3" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
        <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
      </span>
    </span>
  );
}

/** Sliding light/dark switch. */
function ThemeSwitch({ dark, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={onToggle}
      className="relative h-9 w-[4.25rem] shrink-0 rounded-full border border-white/25 bg-white/10 p-1 shadow-inner transition-colors hover:bg-white/20 focus-visible:outline-white"
    >
      <span className="absolute inset-y-0 left-2.5 grid place-items-center text-white/50" aria-hidden="true">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor"><circle cx="10" cy="10" r="4" /></svg>
      </span>
      <span className="absolute inset-y-0 right-2.5 grid place-items-center text-white/50" aria-hidden="true">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" /></svg>
      </span>
      <span
        className={`relative grid h-7 w-7 place-items-center rounded-full bg-white text-hero-2 shadow-md transition-transform duration-300 ease-out-soft ${dark ? "translate-x-8" : "translate-x-0"}`}
      >
        {dark ? (
          <svg key="moon" viewBox="0 0 20 20" className="h-4 w-4 animate-spin-in" fill="currentColor"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" /></svg>
        ) : (
          <svg key="sun" viewBox="0 0 20 20" className="h-4 w-4 animate-spin-in text-amber-500" fill="currentColor"><circle cx="10" cy="10" r="4" /><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="10" y1="1.8" x2="10" y2="3.6" transform={`rotate(${a} 10 10)`} />)}</g></svg>
        )}
      </span>
    </button>
  );
}

export default function Header({ tab, onTab, dark, onToggleTheme, loading }) {
  const [navRef, box] = useIndicator(tab);
  const scrolled = useScrolled();

  // number keys 1–5 jump between views (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
      const t = TABS[Number(e.key) - 1];
      if (t) onTab(t.id);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onTab]);

  // arrow keys move along the tab list, as in any tablist
  const onNavKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length];
    onTab(next.id);
    e.currentTarget.querySelector(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <header className="sticky top-0 z-20 overflow-hidden text-white shadow-[0_10px_40px_-14px_rgb(26_58_156/0.6)]">
      {/* layered background: gradient, drifting light, fine grid, bottom highlight */}
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-r from-hero-1 via-hero-2 to-hero-3" />
      <div aria-hidden="true" className="absolute -left-24 -top-24 h-64 w-96 animate-drift rounded-full bg-accent-2/50 blur-3xl" />
      <div aria-hidden="true" className="absolute -right-16 -top-32 h-72 w-[28rem] animate-drift-slow rounded-full bg-sky-300/35 blur-3xl" />
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px]" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-white/50 to-transparent" />

      {/* one row on wide screens: brand | tabs (centred) | status + theme; on small screens the tabs get their own row */}
      <div className={`relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-4 transition-[padding] duration-300 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] ${scrolled ? "py-2" : "py-3.5"}`}>
        <a href="#overview" onClick={(e) => { e.preventDefault(); onTab("overview"); }} className="group flex min-w-0 items-center gap-3 justify-self-start rounded-xl focus-visible:outline-white">
          <Logo loading={loading} />
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="font-display text-[19px] font-bold tracking-tight sm:text-[21px]">HealthSignal</span>
              <span className="rounded-md bg-linear-to-r from-white to-sky-100 px-1.5 py-0.5 font-display text-[11px] font-bold text-hero-2 shadow-sm">AI</span>
            </div>
            <div className={`grid transition-all duration-300 ${scrolled ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
              <div className="overflow-hidden">
                <div className="mt-1 hidden items-center gap-2 text-[12.5px] tracking-wide text-white/75 sm:flex lg:hidden xl:flex">
                  <span>SARS-CoV-2 test surveillance</span>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span>Carbon Health clinics, 2020</span>
                </div>
              </div>
            </div>
          </div>
        </a>

        <div className="order-last col-span-2 flex min-w-0 justify-center lg:order-none lg:col-span-1">
          <nav
            ref={navRef}
            role="tablist"
            aria-label="Views"
            onKeyDown={onNavKey}
            className="relative flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/10 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_-12px_rgb(0_0_0/0.4)] ring-1 ring-white/20 backdrop-blur-md [scrollbar-width:none]"
          >
            <SlidingPill box={box} className="rounded-xl bg-white shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)]" />
            {TABS.map((t, i) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  aria-keyshortcuts={String(i + 1)}
                  tabIndex={on ? 0 : -1}
                  title={`${t.label} (${i + 1})`}
                  data-active={on}
                  data-tab={t.id}
                  onClick={() => onTab(t.id)}
                  className={`group/tab relative flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-[14px] font-semibold tracking-wide transition-colors focus-visible:outline-white xl:px-3.5 ${
                    on ? "text-hero-2" : "text-white/80 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-all duration-300 ${on ? "bg-linear-to-br from-hero-2 to-accent-2 text-white shadow-[0_4px_10px_-3px_var(--hero-2)]" : "bg-white/10 group-hover/tab:-translate-y-0.5"}`}>
                    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">{t.icon}</svg>
                  </span>
                  <span>{t.short}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5 justify-self-end">
          <ThemeSwitch dark={dark} onToggle={onToggleTheme} />
        </div>
      </div>

      {/* sliding progress line while new numbers load */}
      <div className={`relative h-0.5 overflow-hidden transition-opacity duration-300 ${loading ? "opacity-100" : "opacity-0"}`}>
        <div className="h-full w-2/5 animate-slide-bar rounded-full bg-linear-to-r from-transparent via-white to-transparent" />
      </div>
    </header>
  );
}
