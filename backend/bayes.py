"""
HealthSignal AI — Bayesian network queries.

The network (data/bayes_model.bif) and its description (data/bayes_meta.json) come from
modeling/train_bayes.py. load() reads them once at startup; query() and marginals() then answer
"what share of patients with this profile tested positive?" by variable elimination.

States are the model's: age groups in ASCII ("0-18" … "61+"), symptoms Yes/No, exposure
Yes/No/Unknown, covid Positive/Negative. The dashboard's "0–18" style labels are accepted too.
"""
from __future__ import annotations

import json
import logging
import math
import warnings
from functools import lru_cache

import pandas as pd

import stats

MODEL_PATH = stats.DATA_DIR / "bayes_model.bif"
META_PATH = stats.DATA_DIR / "bayes_meta.json"
MIN_MATCHES = 30          # fewer exact matches than this → warning

_state: dict = {}


class ToolError(ValueError):
    """Bad input to a tool; the message lists the allowed values so the caller can retry."""


# ------------------------------------------------------------------ loading ---
def load(df: pd.DataFrame | None = None) -> None:
    """Read the model, its metadata and the rows used to count matching patients. Safe to call twice."""
    if _state:
        return
    warnings.filterwarnings("ignore", module="pgmpy")
    logging.getLogger("pgmpy").setLevel(logging.ERROR)
    from pgmpy.inference import VariableElimination
    from pgmpy.models import DiscreteBayesianNetwork

    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    model = DiscreteBayesianNetwork.load(str(MODEL_PATH), filetype="bif")
    df = stats.load_data() if df is None else df
    _state.update(meta=meta, model=model, ve=VariableElimination(model), states=meta["variables"],
                  rows=_as_states(df, meta), overall=stats.positivity(df))


def _as_states(df: pd.DataFrame, meta: dict) -> pd.DataFrame:
    """clean.parquet in the model's states, for exact-match counts. Unrecorded symptoms stay missing."""
    yes_no = lambda s: s.map({True: "Yes", False: "No"}).astype(object)  # noqa: E731
    to_ascii = {v: k for k, v in meta["age_group_labels"].items()}
    out = pd.DataFrame(index=df.index)
    for v, states in meta["variables"].items():
        if v == "age_group":
            out[v] = df[v].map(to_ascii)
        elif v == meta["target"]:
            out[v] = df["covid_positive"].map({1: "Positive", 0: "Negative"})
        else:
            out[v] = yes_no(df[v])
            if "Unknown" in states:
                out[v] = out[v].fillna("Unknown")
    return out


def meta() -> dict:
    load()
    return _state["meta"]


def variables() -> dict[str, list[str]]:
    load()
    return _state["states"]


# --------------------------------------------------------------- validation ---
def _state_of(var: str, value) -> str:
    states = variables()[var]
    v = str(value).strip().replace("–", "-")
    v = {"true": "Yes", "false": "No"}.get(v.lower(), v)
    for s in states:
        if s.lower() == v.lower():
            return s
    raise ToolError(f"{value!r} is not a state of {var!r}; allowed: {states}")


def _variable(name) -> str:
    if name not in variables():
        raise ToolError(f"unknown variable {name!r}; allowed: {sorted(variables())}")
    return name


def _evidence(evidence: dict | None) -> tuple[tuple[str, str], ...]:
    """{variable: state} → sorted (variable, state) pairs, hashable for the caches."""
    if evidence is not None and not isinstance(evidence, dict):
        raise ToolError("evidence must be an object of {variable: state}")
    return tuple(sorted((_variable(k), _state_of(k, v)) for k, v in (evidence or {}).items()))


def validate(target: str, evidence: dict | None) -> tuple[str, tuple[tuple[str, str], ...]]:
    """→ (target, sorted (variable, state) pairs). Raises ToolError with the allowed values."""
    target, ev = _variable(target), _evidence(evidence)
    if target in dict(ev):
        raise ToolError(f"{target!r} is the target; it can't also be evidence")
    return target, ev


# ------------------------------------------------------------------ queries ---
def _matches(ev: tuple) -> int:
    rows = _state["rows"]
    m = pd.Series(True, index=rows.index)
    for k, v in ev:
        m &= rows[k] == v
    return int(m.sum())


def _warning(n: int) -> str | None:
    if n >= MIN_MATCHES:
        return None
    return (f"Only {n} patient{'s' if n != 1 else ''} in the data match this profile exactly, so this is mostly "
            "the model's extrapolation from related groups. Treat it with caution.")


@lru_cache(maxsize=2048)
def _query(target: str, ev: tuple) -> dict:
    f = _state["ve"].query([target], evidence=dict(ev), show_progress=False)
    probs = {s: round(float(f.get_value(**{target: s})), 6) for s in variables()[target]}
    n = _matches(ev)
    return {"target": target, "evidence": dict(ev), "probabilities": probs, "matching_patients": n,
            "warning": _warning(n)}


def query(target: str = "covid", evidence: dict | None = None) -> dict:
    """P(each state of target | evidence), plus how many rows match the evidence exactly."""
    load()
    t, ev = validate(target, evidence)
    r = _query(t, ev)
    return {**r, "evidence": dict(r["evidence"]), "probabilities": dict(r["probabilities"])}


@lru_cache(maxsize=512)
def _marginals(ev: tuple) -> dict:
    ev_d = dict(ev)
    free = [v for v in variables() if v not in ev_d]
    out = {v: {s: (1.0 if s == ev_d[v] else 0.0) for s in variables()[v]} for v in ev_d}
    if free:
        fs = _state["ve"].query(free, evidence=ev_d, joint=False, show_progress=False)
        for v in free:
            out[v] = {s: round(float(fs[v].get_value(**{v: s})), 6) for s in variables()[v]}
    return out


@lru_cache(maxsize=512)
def _influence(ev: tuple) -> tuple:
    """Every feature's effect on P(positive), holding the rest of the profile fixed."""
    target, ev_d = meta()["target"], dict(ev)
    out = []
    for v, states in variables().items():
        if v == target:
            continue
        rest = tuple((k, s) for k, s in ev if k != v)
        by_state = {s: _query(target, tuple(sorted(rest + ((v, s),)))) for s in states if s != "Unknown"}
        p = {s: r["probabilities"]["Positive"] for s, r in by_state.items()}
        hi, lo = max(p, key=p.get), min(p, key=p.get)
        out.append({"variable": v, "set": ev_d.get(v), "p_positive_by_state": p,
                    "patients_by_state": {s: r["matching_patients"] for s, r in by_state.items()},
                    "p_positive_if_not_set": _query(target, rest)["probabilities"]["Positive"],
                    "highest": hi, "lowest": lo, "ratio": round(p[hi] / p[lo], 3) if p[lo] else None,
                    "strength": round(math.log(p[hi] / p[lo]), 4) if p[lo] else None})
    out.sort(key=lambda r: -(r["strength"] or 0))
    return tuple({**r, "rank": i + 1} for i, r in enumerate(out))


def influence(evidence: dict | None = None) -> dict:
    """Features ranked by how much they move P(covid = Positive) for patients with this profile.

    For each feature, P(positive) is computed for each of its states with the rest of the profile fixed;
    the effect is the ratio between its highest and lowest state (1 = no effect). Features already in the
    profile are ranked the same way, so you can see how much each given answer matters.
    """
    load()
    target, ev = validate(meta()["target"], evidence)
    base = _query(target, ev)
    return {"evidence": dict(ev), "p_positive": base["probabilities"]["Positive"],
            "matching_patients": base["matching_patients"], "warning": base["warning"],
            "factors": [{**r, "p_positive_by_state": dict(r["p_positive_by_state"]),
                         "patients_by_state": dict(r["patients_by_state"])} for r in _influence(ev)]}


def marginals(evidence: dict | None = None) -> dict:
    """P(each state | evidence) for every variable; evidence variables are fixed at their given state."""
    load()
    ev = _evidence(evidence)  # covid may be evidence here, e.g. "which symptoms if positive?"
    n = _matches(ev)
    return {"evidence": dict(ev), "marginals": {v: dict(p) for v, p in _marginals(ev).items()},
            "matching_patients": n, "warning": _warning(n)}


def overall_positivity() -> dict:
    load()
    return _state["overall"]


def graph() -> dict:
    """Nodes, edges, states and test metrics for drawing the network."""
    m = meta()
    labels = {"age_group": "Age group", m["target"]: "COVID test result", **stats.LABELS}
    kind = lambda v: ("target" if v == m["target"] else "exposure" if v in stats.EXPOSURE  # noqa: E731
                      else "demographic" if v == "age_group" else "symptom")
    return {
        "nodes": [{"id": v, "label": labels.get(v, v), "kind": kind(v), "states": s} for v, s in m["variables"].items()],
        "edges": [{"source": a, "target": b} for a, b in m["edges"]],
        "states": m["variables"],
        "age_group_labels": m["age_group_labels"],
        "target": m["target"],
        "structure": m["chosen_structure"],
        "test_metrics": m["test_metrics"],
        "overall_positivity": m["overall_positivity"],
        "training": m["training"],
        "created": m["created"],
    }
