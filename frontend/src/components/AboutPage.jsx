import { useState } from "react";
import teamPhoto from "../assets/team.jpg";
import { useReducedMotion } from "../lib/motion.js";
import { fmtInt } from "../lib/format.js";
import { ELEVATE } from "./ui.jsx";

const TEAM = [
  {
    name: "Rajarshi Ray", initials: "RR", role: "Biomedical Informatics Researcher",
    org: "Tampere University", city: "Tampere", tags: ["Biomedical informatics", "Health data"],
    tone: ["var(--hue-blue)", "var(--hue-teal)"],
  },
  {
    name: "Yunseon Lee", initials: "YL", role: "Doctoral Researcher in Computer Science",
    org: "University of Helsinki", city: "Helsinki", tags: ["Computer science", "Doctoral research"],
    tone: ["var(--hue-violet)", "var(--hue-coral)"],
  },
];

const VIEWS = [
  { id: "overview", title: "Overview", text: "Weekly positivity, age groups, test types and symptom signals.", color: "var(--hue-blue)",
    icon: "M3 16.5h14M5.5 13.5v-4M10 13.5v-8M14.5 13.5v-6" },
  { id: "conditions", title: "Conditions & exposure", text: "Underlying conditions and high-risk exposure, as odds ratios.", color: "var(--hue-coral)",
    icon: "M10 16.5s-6-3.6-6-8.2A3.3 3.3 0 0 1 10 6.4a3.3 3.3 0 0 1 6 1.9c0 4.6-6 8.2-6 8.2Z" },
  { id: "quality", title: "Data quality", text: "Missing values, duplicates, vital signs and every cleaning step.", color: "var(--hue-teal)",
    icon: "M10 3 4.5 5v4.6c0 3.4 2.4 5.9 5.5 7.4 3.1-1.5 5.5-4 5.5-7.4V5L10 3Zm-2.3 7 1.6 1.6 3-3.1" },
  { id: "whatif", title: "What-if explorer", text: "A Bayesian network: pick a profile and see what moves the estimate.", color: "var(--hue-violet)",
    icon: "M5 5.5a2 2 0 1 0 0 .01M15 5.5a2 2 0 1 0 0 .01M10 15a2 2 0 1 0 0 .01M6.6 7l2.4 6M13.4 7 11 13M7 5.5h6" },
];

const STACK = ["React", "Tailwind CSS", "Recharts", "FastAPI", "pandas", "pgmpy", "Open LLM"];

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

/** Pointer position inside an element as CSS variables, for spotlight and tilt effects. */
function usePointer() {
  const [p, setP] = useState(null);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setP({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };
  return { p, handlers: { onMouseMove: onMove, onMouseLeave: () => setP(null) } };
}

function Photo() {
  const reduced = useReducedMotion();
  const { p, handlers } = usePointer();
  const tilt = p && !reduced ? `perspective(1000px) rotateX(${(0.5 - p.y) * 8}deg) rotateY(${(p.x - 0.5) * 10}deg) scale(1.02)` : "none";
  return (
    <figure className="relative mx-auto w-full max-w-xl animate-rise" {...handlers}>
      {/* soft colour halo behind the photo */}
      <div aria-hidden="true" className="absolute -inset-4 rounded-[2rem] bg-linear-to-br from-hue-blue/40 via-hue-violet/30 to-hue-coral/40 opacity-70 blur-2xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border-4 border-surface shadow-[0_30px_60px_-30px_rgb(30_64_175/0.55)] transition-transform duration-300 ease-out-soft"
        style={{ transform: tilt }}>
        <img src={teamPhoto} alt="Rajarshi Ray and Yunseon Lee under autumn trees in a Finnish street"
          className="block aspect-[4/3] w-full object-cover" loading="lazy" />
        {/* light that follows the pointer */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{ opacity: p ? 1 : 0, background: p ? `radial-gradient(420px circle at ${p.x * 100}% ${p.y * 100}%, rgb(255 255 255 / 0.22), transparent 60%)` : undefined }} />
        <figcaption className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-black/45 px-3 py-1 text-[12.5px] font-semibold text-white backdrop-blur-md">Rajarshi & Yunseon</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-[12px] text-white/90 backdrop-blur-md">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true"><path {...stroke} d="M10 17.5s5.5-4.8 5.5-9a5.5 5.5 0 0 0-11 0c0 4.2 5.5 9 5.5 9Z" /><circle cx="10" cy="8.5" r="1.8" {...stroke} /></svg>
            Finland
          </span>
        </figcaption>
      </div>
    </figure>
  );
}

function Person({ person, delay }) {
  const { p, handlers } = usePointer();
  const [a, b] = person.tone;
  return (
    <article {...handlers}
      className={`group relative min-w-0 animate-rise overflow-hidden rounded-3xl border border-line bg-surface p-6 transition-[transform,border-color,box-shadow] duration-300 ease-out-soft hover:-translate-y-1 hover:border-line-strong sm:p-7 ${ELEVATE}`}
      style={{ animationDelay: `${delay}ms` }}>
      {/* coloured top edge and a spotlight that follows the pointer */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ background: `linear-gradient(90deg, ${a}, ${b})` }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{ opacity: p ? 1 : 0, background: p ? `radial-gradient(360px circle at ${p.x * 100}% ${p.y * 100}%, color-mix(in srgb, ${a} 12%, transparent), transparent 70%)` : undefined }} />

      <div className="relative flex items-center gap-4">
        <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
          <span aria-hidden="true" className="absolute inset-0 rounded-full transition-transform duration-700 ease-out-soft group-hover:rotate-180"
            style={{ background: `conic-gradient(from 0deg, ${a}, ${b}, ${a})` }} />
          <span className="relative grid h-[64px] w-[64px] place-items-center rounded-full bg-surface font-display text-[20px] font-bold"
            style={{ color: a }}>{person.initials}</span>
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[24px]">{person.name}</h3>
          <p className="mt-1 text-[14px] font-semibold" style={{ color: a }}>{person.role}</p>
        </div>
      </div>

      <dl className="relative mt-5 grid gap-2.5 text-[14px]">
        <div className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2.5 transition-colors group-hover:bg-accent-soft/60">
          <dt className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path {...stroke} d="M2.5 8 10 4l7.5 4M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M3 16.5h14" /></svg>
            <span className="sr-only">Affiliation</span>
          </dt>
          <dd className="min-w-0">
            <div className="font-semibold text-ink">{person.org}</div>
            <div className="text-[12.5px] text-ink-3">{person.city}, Finland</div>
          </dd>
        </div>
      </dl>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {person.tags.map((t) => (
          <span key={t} className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 ring-1 ring-line transition-colors group-hover:ring-line-strong"
            style={{ background: `color-mix(in srgb, ${a} 9%, var(--surface))` }}>{t}</span>
        ))}
      </div>
    </article>
  );
}

export default function AboutPage({ onTab, records }) {
  return (
    <div className="grid gap-6">
      {/* hero: who we are and what this is */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-hue-violet/15 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-hue-blue/15 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-bold uppercase tracking-wider text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> About us
            </span>
            <h1 className="mt-4 font-display text-[30px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[40px]">
              The people behind{" "}
              <span className="bg-linear-to-r from-hue-blue via-hue-violet to-hue-coral bg-clip-text text-transparent">HealthSignal</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-2">
              HealthSignal turns {records ? fmtInt(records) : "93,995"} SARS-CoV-2 test records from Carbon Health clinics into an
              interactive dashboard, a Bayesian what-if explorer and an AI assistant that only quotes numbers the dashboard has
              computed.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => onTab("overview")}
                className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-accent to-accent-2 px-4 py-2.5 text-[14px] font-semibold text-white shadow-[0_10px_24px_-10px_var(--accent)] transition-transform hover:-translate-y-0.5 active:scale-95">
                Explore the dashboard
                <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path {...stroke} d="M4 10h12m-5-5 5 5-5 5" /></svg>
              </button>
              <button type="button" onClick={() => onTab("whatif")}
                className="rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent">
                Try the What-if explorer
              </button>
            </div>
          </div>
          <Photo />
        </div>
      </section>

      {/* the two of us, side by side */}
      <section aria-labelledby="team-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 px-1">
          <h2 id="team-title" className="font-display text-[22px] font-bold tracking-tight text-ink">Meet the team</h2>
          <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
            Tampere
            <span aria-hidden="true" className="relative h-px w-16 bg-line-strong">
              <span className="absolute -top-[3px] left-0 h-[7px] w-[7px] animate-[bridge_2.4s_ease-in-out_infinite_alternate] rounded-full bg-accent motion-reduce:animate-none" />
            </span>
            Helsinki
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {TEAM.map((t, i) => <Person key={t.name} person={t} delay={i * 120} />)}
        </div>
      </section>

      {/* what you can do here, each tile opens that view */}
      <section aria-labelledby="built-title" className={`rounded-3xl border border-line bg-surface p-6 sm:p-8 ${ELEVATE}`}>
        <h2 id="built-title" className="font-display text-[20px] font-bold tracking-tight text-ink">What we built</h2>
        <p className="mt-1 text-[14px] text-ink-3">Four views over the same data. Pick one to jump in.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => onTab(v.id)}
              className="group relative flex min-w-0 flex-col items-start overflow-hidden rounded-2xl border border-line bg-bg p-4 text-left transition-all duration-300 ease-out-soft hover:-translate-y-1 hover:border-transparent hover:shadow-[0_18px_40px_-20px_rgb(30_64_175/0.45)]">
              <span aria-hidden="true" className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${v.color} 14%, var(--surface)), var(--surface))` }} />
              <span className="relative grid h-10 w-10 place-items-center rounded-xl text-white shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
                style={{ background: v.color }}>
                <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true"><path {...stroke} d={v.icon} /></svg>
              </span>
              <span className="relative mt-3 text-[15px] font-bold text-ink">{v.title}</span>
              <span className="relative mt-1 text-[13px] leading-snug text-ink-2">{v.text}</span>
              <span className="relative mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold transition-[gap] duration-300 group-hover:gap-2" style={{ color: v.color }}>
                Open
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true"><path {...stroke} d="M4 10h12m-5-5 5 5-5 5" /></svg>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-1.5 border-t border-line pt-5">
          <span className="mr-1 text-[12.5px] text-ink-3">Built with</span>
          {STACK.map((s) => (
            <span key={s} className="rounded-full bg-bg px-2.5 py-1 text-[12px] font-semibold text-ink-2 ring-1 ring-line transition-colors hover:text-accent hover:ring-accent">{s}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
