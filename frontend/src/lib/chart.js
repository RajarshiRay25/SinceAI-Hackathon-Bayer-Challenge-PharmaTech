// Shared Recharts styling so every chart looks the same in light and dark mode.
export const tick = { fill: "var(--ink-3)", fontSize: 11, fontFamily: "IBM Plex Mono, ui-monospace, monospace" };
export const labelTick = { fill: "var(--ink-2)", fontSize: 12, fontFamily: "Public Sans, Arial, sans-serif" };
export const grid = { stroke: "var(--line)", strokeDasharray: "0", vertical: false };
export const axisLine = { stroke: "var(--line-strong)" };
export const cursor = { fill: "var(--ink)", fillOpacity: 0.05 };
export const C = {
  pos: "var(--pos)",
  posSoft: "var(--pos-soft)",
  neg: "var(--neg)",
  negSoft: "var(--neg-soft)",
  ns: "var(--ns)",
  ink2: "var(--ink-2)",
  ink3: "var(--ink-3)",
  surface: "var(--surface)",
  accent: "var(--accent)",
};
/** Round axis: returns { domain, ticks } that end on a tidy number above `max`. */
export function niceAxis(max, count = 4) {
  if (!(max > 0)) return { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { domain: [0, top], ticks };
}
export const pctTick = (v) => `${+v.toFixed(2)}%`;
