import { useEffect, useLayoutEffect, useRef, useState } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** True when the user asked the OS for less motion. Charts pass `!reduced` to isAnimationActive. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Shared Recharts animation props: quick, eased, off for reduced motion. */
export function useChartAnim() {
  const reduced = useReducedMotion();
  return { isAnimationActive: !reduced, animationDuration: 550, animationEasing: "ease-out" };
}

/** Tween a number from its previous value to `target`. */
export function useCountUp(target, duration = 700) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target ?? 0);
  const from = useRef(target ?? 0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;
    if (reduced) { from.current = target; setValue(target); return; }
    const start = performance.now(), a = from.current;
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration), e = 1 - (1 - p) ** 3;
      const v = a + (target - a) * e;
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return target == null ? null : value;
}

/** Position of the active child inside a container, for a sliding highlight behind tabs/toggles. */
export function useIndicator(activeKey) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector("[data-active='true']");
      setBox(a ? { left: a.offsetLeft, width: a.offsetWidth, top: a.offsetTop, height: a.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey]);
  return [ref, box];
}

/** False on the first paint, true right after. Lets CSS width/height transitions grow from zero on mount. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return m;
}
