import { Fragment, useEffect, useRef, useState } from "react";
import { getChatStatus, sendChat } from "../api.js";
import { EMPTY_FILTERS, fmtWeek } from "../lib/format.js";

const STORE = "hs-chat";
const CODE_STORE = "hs-chat-code"; // the demo access code, kept for this browser tab only

const SUGGESTIONS = {
  overview: [
    "Summarise my current selection",
    "Which age group has the highest positivity?",
    "What's the strongest symptom signal?",
    "How did positivity change over the weeks?",
  ],
  conditions: [
    "Which condition is most linked to a positive test?",
    "Does a high-risk occupation matter?",
    "Why might hypertension look weaker than expected?",
  ],
  quality: [
    "Where is most data missing?",
    "How do duplicate rows affect positivity?",
    "Do vital signs differ for positive patients?",
  ],
  whatif: [
    "What share of patients who lost their sense of smell tested positive?",
    "How about people over 60 with a fever and cough?",
    "How reliable are the What-if estimates?",
  ],
};

// what each statistic the bot looked at is called in the "Checked" chips
const SOURCE_LABEL = {
  positivity: "Positivity", get_positivity: "Positivity",
  by_age: "By age", by_test: "By test type", by_symptom_status: "By symptom status", by_week: "By week",
  by_symptom_count: "By symptom count", positivity_by_group: "Positivity by group",
  symptoms: "Symptom odds", conditions: "Condition odds", exposure: "Exposure odds",
  rank_variables: "Odds ranking", variable_detail: "Variable detail",
  missingness: "Missing values", duplicates: "Duplicates", vitals: "Vital signs", cleaning_log: "Cleaning log",
  data_quality: "Data quality", what_if: "Bayesian what-if",
};

const PROGRESS = ["Choosing the right statistics…", "Computing from the data…", "Writing the answer…"];

function describeFilters(f) {
  if (!f) return "All tests";
  const parts = [
    f.age_groups?.length && `Age ${f.age_groups.join(", ")}`,
    f.test_categories?.length && f.test_categories.join(", "),
    f.symptom_status?.length && f.symptom_status.join(", "),
    (f.week_from || f.week_to) && `${f.week_from ? fmtWeek(f.week_from) : "start"} – ${f.week_to ? fmtWeek(f.week_to) : "end"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All tests";
}

/* ---- tiny Markdown: paragraphs, bullet/numbered lists, **bold**, `code`. Built from React nodes, never HTML. */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") ? <code key={i} className="rounded bg-bg px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
        : <Fragment key={i}>{part}</Fragment>,
  );
}

function Markdown({ text }) {
  const blocks = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line), num = /^\s*\d+[.)]\s+(.*)/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || num) {
      const type = bullet ? "ul" : "ol";
      if (last?.type === type) last.items.push((bullet || num)[1]);
      else blocks.push({ type, items: [(bullet || num)[1]] });
    } else if (!line.trim()) {
      blocks.push({ type: "gap" });
    } else if (last?.type === "p") {
      last.lines.push(line.replace(/^#+\s*/, ""));
    } else {
      blocks.push({ type: "p", lines: [line.replace(/^#+\s*/, "")] });
    }
  }
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) =>
        b.type === "p" ? <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
          : b.type === "ul" ? <ul key={i} className="grid list-disc gap-1 pl-4 marker:text-accent">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
            : b.type === "ol" ? <ol key={i} className="grid list-decimal gap-1 pl-4 marker:text-accent">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>
              : null,
      )}
    </div>
  );
}

const Spark = ({ className = "h-5 w-5" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 2.5c.4 3.9 1.9 6.6 6.8 7.3-4.9.8-6.4 3.4-6.8 7.4-.4-4-1.9-6.6-6.8-7.4 4.9-.7 6.4-3.4 6.8-7.3Z" />
    <path d="M19 15.5c.2 1.8.9 3 3 3.3-2.1.4-2.8 1.5-3 3.2-.2-1.7-.9-2.8-3-3.2 2.1-.3 2.8-1.5 3-3.3Z" opacity=".75" />
  </svg>
);

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-linear-to-br from-accent to-accent-2 text-white shadow-sm">
      <Spark className="h-4 w-4" />
    </span>
  );
}

const BUDDY_STORE = "hs-chat-buddy"; // set when the visitor hides the robot for this tab

/** Floating robot above the launcher: bobs, blinks, follows the pointer with its eyes, opens the chat on click. */
function RobotBuddy({ onOpen }) {
  const eyes = useRef(null);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(BUDDY_STORE) === "1"; } catch { return false; }
  });

  useEffect(() => {
    if (hidden) return;
    let frame = 0;
    const look = (e) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = eyes.current;
        if (!el) return;
        const r = el.ownerSVGElement.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 300) * 2.6; // eyes move at most ~2.6 units inside the visor
        el.setAttribute("transform", `translate(${(dx / d) * k} ${(dy / d) * k})`);
      });
    };
    addEventListener("pointermove", look, { passive: true });
    return () => { removeEventListener("pointermove", look); cancelAnimationFrame(frame); };
  }, [hidden]);

  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try { sessionStorage.setItem(BUDDY_STORE, "1"); } catch { /* storage blocked */ }
  };

  return (
    <div className="group/buddy fixed bottom-[5.5rem] right-[1.125rem] z-40 flex animate-rise items-center gap-2.5">
      <div className="relative animate-float [animation-delay:-1.6s]">
        <button type="button" onClick={onOpen}
          className="relative rounded-2xl rounded-br-md bg-surface px-3.5 py-2 text-left text-[13.5px] font-semibold text-ink shadow-[0_10px_28px_-10px_rgb(0_0_0/0.35)] ring-1 ring-line transition-all duration-300 hover:-translate-y-0.5 hover:text-accent hover:ring-accent">
          <span className="flex items-center gap-1.5">
            Chat with me!
            <span className="inline-block origin-[70%_70%] transition-transform duration-300 group-hover/buddy:rotate-[18deg]" aria-hidden="true">👋</span>
          </span>
          <span className="block text-[11.5px] font-medium text-ink-3">Ask me about the data</span>
          {/* tail pointing at the robot */}
          <span aria-hidden="true" className="absolute -right-1.5 bottom-2.5 h-3 w-3 rotate-45 bg-surface ring-1 ring-line [clip-path:polygon(100%_0,100%_100%,0_0)]" />
        </button>
        <button type="button" onClick={hide} aria-label="Hide the chat robot" title="Hide"
          className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-surface text-[13px] leading-none text-ink-3 opacity-0 shadow ring-1 ring-line transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/buddy:opacity-100">
          ×
        </button>
      </div>

      <button type="button" onClick={onOpen} aria-label="Chat with HealthSignal"
        className="animate-float rounded-2xl transition-transform duration-300 hover:-rotate-6 hover:scale-110 active:scale-95">
        <svg viewBox="0 0 64 64" className="h-14 w-14 drop-shadow-[0_10px_14px_rgb(26_58_156/0.35)]" aria-hidden="true">
          <defs>
            <linearGradient id="bot-head" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#dbe6ff" />
            </linearGradient>
            <linearGradient id="bot-visor" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="var(--hero-1)" />
              <stop offset="1" stopColor="var(--hero-2)" />
            </linearGradient>
          </defs>
          {/* antenna */}
          <line x1="32" y1="7" x2="32" y2="15" stroke="#c7d4f5" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="32" cy="6" r="3.6" fill="var(--accent-2)" className="animate-pulse" />
          {/* ears */}
          <rect x="3.5" y="28" width="6" height="13" rx="3" fill="var(--accent)" />
          <rect x="54.5" y="28" width="6" height="13" rx="3" fill="var(--accent)" />
          {/* head and visor */}
          <rect x="8" y="14" width="48" height="40" rx="15" fill="url(#bot-head)" stroke="#c7d4f5" strokeWidth="1.5" />
          <rect x="14" y="21" width="36" height="24" rx="10" fill="url(#bot-visor)" />
          <g ref={eyes} style={{ transition: "transform 120ms ease-out" }}>
            <g className="animate-blink [transform-box:fill-box] [transform-origin:center]">
              <ellipse cx="25" cy="31" rx="3.4" ry="4" fill="#9fe7ff" />
              <ellipse cx="39" cy="31" rx="3.4" ry="4" fill="#9fe7ff" />
              <circle cx="26.2" cy="29.6" r="1.1" fill="#fff" />
              <circle cx="40.2" cy="29.6" r="1.1" fill="#fff" />
            </g>
          </g>
          <path d="M27.5 38.5q4.5 3.2 9 0" fill="none" stroke="#9fe7ff" strokeWidth="2" strokeLinecap="round" />
          <circle cx="18" cy="40" r="2" fill="#fda4af" opacity=".55" />
          <circle cx="46" cy="40" r="2" fill="#fda4af" opacity=".55" />
        </svg>
      </button>
    </div>
  );
}

function Sources({ used }) {
  if (!used?.length) return null;
  const names = [...new Set(used.map((u) => SOURCE_LABEL[u.name] ?? u.name))];
  const sel = describeFilters(used[0]?.args?.filters);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-hue-teal" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
      <span>Checked</span>
      {names.map((n) => <span key={n} className="rounded-full bg-bg px-1.5 py-0.5 ring-1 ring-line">{n}</span>)}
      <span>for <b className="font-semibold text-ink-2">{sel}</b></span>
    </div>
  );
}

/** Shown when the server asks for the demo's access code (401). */
function CodeForm({ message, onUnlock }) {
  const [code, setCode] = useState("");
  const submit = (e) => { e.preventDefault(); if (code.trim()) onUnlock(code.trim()); };
  return (
    <div className="flex animate-fade-in gap-2">
      <Avatar />
      <form onSubmit={submit} className="max-w-[85%] rounded-2xl rounded-tl-md border border-accent/30 bg-accent-soft/60 px-3.5 py-2.5 text-[13px] text-ink">
        <div className="flex items-start gap-2">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
          </svg>
          <span className="text-ink-2">{message}</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" aria-label="Access code"
            autoComplete="off" autoFocus
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent" />
          <button type="submit" disabled={!code.trim()}
            className="rounded-lg bg-linear-to-r from-accent to-accent-2 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-opacity disabled:opacity-50">
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

function Message({ m, onRetry, onUnlock }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return (
      <div className="flex animate-fade-in justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-linear-to-br from-accent to-accent-2 px-3.5 py-2 text-[13.5px] leading-relaxed text-white shadow-sm">
          {m.content}
        </div>
      </div>
    );
  }
  if (m.error && m.status === 401) return <CodeForm message={m.content} onUnlock={onUnlock} />;
  if (m.error && m.status === 429) {
    return (
      <div className="flex animate-fade-in gap-2">
        <Avatar />
        <div className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-tl-md bg-warn-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-warn-ink">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" />
          </svg>
          <span><b>Taking a short break.</b> {m.content}</span>
        </div>
      </div>
    );
  }
  if (m.error) {
    return (
      <div className="flex animate-fade-in gap-2">
        <Avatar />
        <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-pos/40 bg-pos-soft/40 px-3.5 py-2 text-[13px] text-ink">
          <b>Couldn't get an answer.</b> <span className="text-ink-2">{m.content}</span>
          <button onClick={onRetry} className="mt-1.5 block text-[12px] font-semibold text-accent underline underline-offset-2">Try again</button>
        </div>
      </div>
    );
  }
  const copy = () => {
    navigator.clipboard?.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return (
    <div className="group flex animate-fade-in gap-2">
      <Avatar />
      <div className="min-w-0 max-w-[88%]">
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-2 shadow-sm">
          <Markdown text={m.content} />
        </div>
        <Sources used={m.used} />
        <button onClick={copy} className="mt-1 text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 focus-visible:opacity-100">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Typing({ step }) {
  return (
    <div className="flex animate-fade-in gap-2">
      <Avatar />
      <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 shadow-sm">
        <div className="flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 150}ms` }} />)}
        </div>
        <div key={step} className="mt-1 animate-fade-in text-[11.5px] text-ink-3" aria-live="polite">{PROGRESS[step]}</div>
      </div>
    </div>
  );
}

export default function ChatPanel({ filters, tab, records }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE)) ?? []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [useFilters, setUseFilters] = useState(true);
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem(CODE_STORE) ?? ""; } catch { return ""; } });
  const ctrl = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const scope = useFilters ? filters : EMPTY_FILTERS;

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40))); } catch {}
  }, [messages]);

  // check the backend once the panel is first opened
  useEffect(() => {
    if (open && !status) getChatStatus().then(setStatus, () => setStatus({ configured: false, offline: true }));
  }, [open, status]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(PROGRESS.length - 1, s + 1)), 3500);
    return () => clearInterval(t);
  }, [busy]);

  // "/" opens the assistant, Escape closes it
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && open) setOpen(false);
      if (e.key === "/" && !open && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); setOpen(true); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  const saveCode = (c) => {
    setCode(c);
    try { c ? sessionStorage.setItem(CODE_STORE, c) : sessionStorage.removeItem(CODE_STORE); } catch {}
  };

  const ask = async (history, accessCode = code) => {
    setBusy(true);
    ctrl.current = new AbortController();
    try {
      const payload = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const r = await sendChat(payload, scope, tab, ctrl.current.signal, accessCode);
      setMessages([...history, { role: "assistant", content: r.reply || "(The model returned an empty answer.)", used: r.tools_used }]);
    } catch (e) {
      if (e.status === 401) saveCode(""); // a stored code that no longer works is forgotten
      if (e.name !== "AbortError") setMessages([...history, { role: "assistant", error: true, status: e.status, content: e.message, id: Date.now() }]);
    } finally {
      setBusy(false);
    }
  };

  const send = (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    ask([...messages.filter((m) => !m.error), { role: "user", content: q }]);
  };

  const retry = () => {
    const history = messages.filter((m) => !m.error);
    if (history[history.length - 1]?.role === "user") ask(history);
  };

  // access code entered: keep it for this browser tab and re-send the question that was refused
  const unlock = (c) => {
    saveCode(c);
    const history = messages.filter((m) => !m.error);
    if (history[history.length - 1]?.role === "user") ask(history, c);
  };

  const stop = () => ctrl.current?.abort();
  const reset = () => { stop(); setMessages([]); setInput(""); };

  const notReady = status && !status.configured;

  return (
    <>
      {!open && <RobotBuddy onOpen={() => setOpen(true)} />}

      {/* launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Ask HealthSignal (press /)"}
        title="Ask HealthSignal (/)"
        className={`group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-linear-to-r from-hero-1 via-accent to-accent-2 p-3.5 text-white shadow-[0_12px_32px_-8px_var(--accent)] ring-1 ring-white/30 transition-all duration-300 hover:pr-5 hover:shadow-[0_16px_40px_-8px_var(--accent)] active:scale-95 ${open ? "scale-90 opacity-0 pointer-events-none" : "animate-rise"}`}
      >
        <span className="relative">
          <Spark className="h-6 w-6 transition-transform duration-500 group-hover:rotate-[20deg] group-hover:scale-110" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-ping rounded-full bg-sky-200/80" />
        </span>
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-[14px] font-semibold transition-all duration-300 group-hover:max-w-40">
          Ask HealthSignal
        </span>
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="HealthSignal assistant"
          className="fixed inset-2 z-50 flex animate-rise flex-col overflow-hidden rounded-3xl border border-line bg-bg shadow-[0_30px_80px_-20px_rgb(15_29_58/0.55)] sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(42rem,calc(100vh-6rem))] sm:w-[26rem]"
        >
          {/* header */}
          <header className="relative overflow-hidden px-4 pb-3 pt-4 text-white">
            <div aria-hidden="true" className="absolute inset-0 bg-linear-to-br from-hero-1 via-hero-2 to-accent-2" />
            <div aria-hidden="true" className="absolute -right-10 -top-16 h-40 w-40 animate-drift rounded-full bg-sky-300/30 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur"><Spark /></span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15px] font-bold tracking-tight">Ask HealthSignal</div>
                <div className="flex items-center gap-1.5 truncate text-[11.5px] text-white/75">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${!status ? "bg-white/50" : status.configured ? "bg-emerald-300" : "bg-amber-300"}`} />
                  {!status ? "Connecting…" : status.configured ? status.model : status.offline ? "Backend offline" : "Not configured"}
                </div>
              </div>
              <button onClick={reset} title="New conversation" aria-label="New conversation"
                className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 10a6 6 0 1 0 2-4.5M4 3.5v3h3" /></svg>
              </button>
              <button onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close assistant"
                className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>
              </button>
            </div>

            {/* which data the answers use */}
            <div className="relative mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[12px] ring-1 ring-white/20 backdrop-blur">
              <span className="min-w-0 truncate">
                <span className="text-white/70">Answering about </span>
                <b className="font-semibold">{useFilters && hasFilters ? describeFilters(filters) : `all ${records ? records.toLocaleString("en-US") : ""} tests`}</b>
              </span>
              {hasFilters && (
                <button role="switch" aria-checked={useFilters} onClick={() => setUseFilters((u) => !u)}
                  className="flex shrink-0 items-center gap-1.5 text-white/80 hover:text-white">
                  <span className="text-[11px]">My filters</span>
                  <span className={`relative h-4 w-7 rounded-full transition-colors ${useFilters ? "bg-emerald-400" : "bg-white/25"}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${useFilters ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </span>
                </button>
              )}
            </div>
          </header>

          {/* conversation */}
          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="animate-fade-in">
                <div className="flex gap-2">
                  <Avatar />
                  <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-2 shadow-sm">
                    Hi! Ask me anything about this test data: who tested positive, which symptoms or conditions stand out,
                    trends over time, or data quality. Every number I give comes straight from the dashboard's statistics.
                  </div>
                </div>
                {notReady && (
                  <div className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-[12.5px] text-warn-ink">
                    {status.offline
                      ? "Can't reach the backend. Start it, then reopen this panel."
                      : <>The assistant needs <code className="font-mono">LLM_BASE_URL</code>, <code className="font-mono">LLM_API_KEY</code> and <code className="font-mono">LLM_MODEL</code> in <code className="font-mono">backend/.env</code>.</>}
                  </div>
                )}
                <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-3">Try asking</div>
                <div className="mt-2 grid gap-1.5">
                  {(SUGGESTIONS[tab] ?? SUGGESTIONS.overview).map((s, i) => (
                    <button key={s} onClick={() => send(s)} disabled={busy}
                      className="group flex animate-fade-in items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] text-ink-2 transition-all hover:-translate-y-px hover:border-accent hover:text-ink hover:shadow-sm"
                      style={{ animationDelay: `${i * 60}ms` }}>
                      {s}
                      <span className="text-accent opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => <Message key={`${i}-${m.id ?? ""}`} m={m} onRetry={retry} onUnlock={unlock} />)}
            {busy && <Typing step={step} />}
          </div>

          {/* composer */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t border-line bg-surface px-3 pb-2.5 pt-2.5"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-bg px-3 py-1.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask about the data…"
                aria-label="Your question"
                maxLength={2000}
                className="max-h-[120px] flex-1 resize-none bg-transparent py-1.5 focus-visible:outline-none text-[13.5px] text-ink outline-none placeholder:text-ink-3"
              />
              {busy ? (
                <button type="button" onClick={stop} aria-label="Stop"
                  className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ink text-bg transition-transform active:scale-90">
                  <span className="h-2.5 w-2.5 rounded-sm bg-current" />
                </button>
              ) : (
                <button type="submit" disabled={!input.trim()} aria-label="Send"
                  className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-linear-to-br from-accent to-accent-2 text-white shadow-sm transition-all enabled:hover:scale-105 enabled:active:scale-90 disabled:opacity-35">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M3.4 16.6 17.5 10 3.4 3.4l1.9 5.4L12 10l-6.7 1.2-1.9 5.4Z" /></svg>
                </button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-[10.5px] leading-snug text-ink-3">
              Answers describe aggregated 2020 test data and can be wrong. Not medical advice. Enter to send, Shift+Enter for a new line.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
