"""
HealthSignal AI — Bayesian network for P(COVID positive | age, exposure, symptoms).

Run from the project root:   python modeling/train_bayes.py

Builds two structures (expert DAG, BIC hill-climb DAG), fits each with a BDeu prior on
batches up to 2020-08-31, tests on Sep–Oct 2020 against a constant baseline and a logistic
regression, refits the winner on all data and writes:
  backend/data/bayes_model.bif, backend/data/bayes_meta.json,
  modeling/bayes_report.md, modeling/figures/*.png
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import warnings
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_curve, roc_auc_score

warnings.filterwarnings("ignore")
import logging
logging.getLogger("pgmpy").setLevel(logging.ERROR)

from pgmpy.causal_discovery import ExpertKnowledge
from pgmpy.estimators import BIC, BayesianEstimator, HillClimbSearch
from pgmpy.inference import VariableElimination
from pgmpy.models import DiscreteBayesianNetwork

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import stats  # noqa: E402

DATA = ROOT / "backend" / "data"
OUT = Path(__file__).resolve().parent
FIG = OUT / "figures"
FIG.mkdir(exist_ok=True)

SPLIT = pd.Timestamp("2020-08-31")
SEED = 7
N_BOOT = 1000
HASH_SEED = "0"                        # hill-climb tie-breaks follow set order, i.e. string hashing
STABILITY_SEEDS = ["1", "2", "3", "4", "5"]

# ---------------------------------------------------------------- variables ---
SYMPTOMS = stats.SYMPTOMS
EXPOSURE = stats.EXPOSURE
AGE = [a.replace("–", "-") for a in stats.AGE_GROUPS]      # BIF-safe ASCII: "0-18" … "61+"
TARGET = "covid"
FEATURES = ["age_group", *EXPOSURE, *SYMPTOMS]
VARIABLES = [*FEATURES, TARGET]
YN = ["No", "Yes"]
STATES = {"age_group": AGE, TARGET: ["Negative", "Positive"],
          **{v: [*YN, "Unknown"] for v in EXPOSURE}, **{v: YN for v in SYMPTOMS}}


def yes_no(s: pd.Series) -> pd.Series:
    return s.map({True: "Yes", False: "No"}).astype(object).where(s.notna(), None)


# --------------------------------------------------------------------- data ---
def load() -> tuple[pd.DataFrame, dict]:
    raw = pd.read_parquet(DATA / "clean.parquet")
    info = {"rows_raw": len(raw)}
    raw = raw[raw["age_group"] != "Unknown"]
    info["dropped_unknown_age"] = info["rows_raw"] - len(raw)
    true_dup = raw["is_exact_duplicate"].astype(bool) & raw[stats.VITALS].notna().all(axis=1)
    info["dropped_true_duplicates"] = int(true_dup.sum())
    raw = raw[~true_dup]

    d = pd.DataFrame(index=raw.index)
    d["batch_date"] = raw["batch_date"]
    d["age_group"] = raw["age_group"].str.replace("–", "-")
    for v in EXPOSURE:                                       # missing exposure → its own state
        d[v] = yes_no(raw[v]).fillna("Unknown")
    for v in SYMPTOMS:                                       # missing symptoms stay missing
        d[v] = yes_no(raw[v])
    d[TARGET] = np.where(raw["covid_positive"] == 1, "Positive", "Negative")
    d["is_exact_duplicate"] = raw["is_exact_duplicate"].astype(bool)
    info["rows_used"] = len(d)
    return d, info


def complete(d: pd.DataFrame) -> pd.DataFrame:
    """Rows where every network variable is recorded (exposure always is: Unknown is a state)."""
    return d[d[VARIABLES].notna().all(axis=1)]


def y_of(d: pd.DataFrame) -> np.ndarray:
    return (d[TARGET] == "Positive").to_numpy().astype(int)


# ---------------------------------------------------------------- structures ---
EXPERT_EDGES = ([("age_group", TARGET)] + [(v, TARGET) for v in EXPOSURE] + [(TARGET, s) for s in SYMPTOMS]
                + [("loss_of_smell", "loss_of_taste"), ("cough", "sob"),
                   ("age_group", "runny_nose"), ("age_group", "sore_throat")])


def learn_structure(train: pd.DataFrame) -> list[tuple[str, str]]:
    forbidden = [(v, "age_group") for v in VARIABLES if v != "age_group"] + [(s, TARGET) for s in SYMPTOMS]
    hc = HillClimbSearch(train[VARIABLES])
    dag = hc.estimate(scoring_method=BIC(train[VARIABLES], state_names=STATES),
                      expert_knowledge=ExpertKnowledge(forbidden_edges=forbidden), show_progress=False)
    return sorted(dag.edges())


def learn_with_seed(seed: str) -> list[tuple[str, str]]:
    """Same search in a fresh interpreter with another PYTHONHASHSEED, to see how stable the structure is."""
    out = subprocess.run([sys.executable, __file__, "--learn-only"], env={**os.environ, "PYTHONHASHSEED": seed},
                         capture_output=True, text=True, check=True)
    return [tuple(e) for e in json.loads(out.stdout.strip().splitlines()[-1])]


def fit(edges, data: pd.DataFrame) -> DiscreteBayesianNetwork:
    m = DiscreteBayesianNetwork(edges)
    m.add_nodes_from(VARIABLES)
    est = BayesianEstimator(m, data[VARIABLES], state_names=STATES)
    m.add_cpds(*est.get_parameters(prior_type="BDeu", equivalent_sample_size=10))
    m.check_model()
    return m


def predict(m: DiscreteBayesianNetwork, d: pd.DataFrame) -> np.ndarray:
    """P(covid=Positive | every recorded variable in the row); queries are cached per evidence pattern."""
    ve, cache, out = VariableElimination(m), {}, np.empty(len(d))
    for i, row in enumerate(d[FEATURES].itertuples(index=False, name=None)):
        key = tuple(row)
        if key not in cache:
            ev = {k: v for k, v in zip(FEATURES, key) if v is not None}
            q = ve.query([TARGET], evidence=ev, show_progress=False)
            cache[key] = float(q.get_value(**{TARGET: "Positive"}))
        out[i] = cache[key]
    return out


def p_given(m, evidence: dict) -> float:
    q = VariableElimination(m).query([TARGET], evidence=evidence, show_progress=False)
    return float(q.get_value(**{TARGET: "Positive"}))


# ----------------------------------------------------------- logistic model ---
class Logistic:
    """Same variables: one-hot age and 3-state exposure, symptoms 0/1. Symptoms missing at test time
    get the training mean (the average answer), never 'No'."""

    def __init__(self, train: pd.DataFrame):
        X = self._x(train)
        self.means = X.mean()
        self.cols = X.columns
        self.clf = LogisticRegression(max_iter=2000).fit(X, y_of(train))

    def _x(self, d: pd.DataFrame) -> pd.DataFrame:
        parts = [pd.get_dummies(pd.Categorical(d[v], categories=STATES[v]), prefix=v).set_index(d.index)
                 for v in ["age_group", *EXPOSURE]]
        sym = d[SYMPTOMS].apply(lambda s: s.map({"Yes": 1.0, "No": 0.0}))
        return pd.concat([*parts, sym], axis=1).astype(float)

    def predict(self, d: pd.DataFrame) -> np.ndarray:
        X = self._x(d)[self.cols].fillna(self.means)
        return self.clf.predict_proba(X)[:, 1]

    def coefs(self) -> dict:
        return dict(zip(self.cols, self.clf.coef_[0].round(3)))


# ------------------------------------------------------------------ metrics ---
def calibration(y, p, bins=10) -> pd.DataFrame:
    """Equal-count bins by predicted risk (positives are rare, so equal-width bins would all be in 0–10%)."""
    order = np.argsort(p, kind="stable")
    b = np.empty(len(p), int)
    b[order] = np.arange(len(p)) * bins // len(p)
    t = pd.DataFrame({"bin": b + 1, "p": p, "y": y}).groupby("bin").agg(
        n=("y", "size"), positives=("y", "sum"), mean_pred=("p", "mean"), observed=("y", "mean"),
        p_min=("p", "min"), p_max=("p", "max"))
    return t.reset_index()


def metrics(y, p) -> dict:
    cal = calibration(y, p)
    ece = float((cal["n"] * (cal["mean_pred"] - cal["observed"]).abs()).sum() / len(y))
    return {"pr_auc": float(average_precision_score(y, p)), "roc_auc": float(roc_auc_score(y, p)),
            "brier": float(brier_score_loss(y, p)), "ece": ece, "mean_pred": float(np.mean(p)),
            "observed": float(np.mean(y)), "n": int(len(y)), "positives": int(np.sum(y))}


def boot_diff(y, p1, p2, n=N_BOOT) -> tuple[float, float, float]:
    """Paired bootstrap of PR-AUC(p1) − PR-AUC(p2): point estimate and 95% interval."""
    rng = np.random.default_rng(SEED)
    diffs = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].sum() == 0:
            continue
        diffs.append(average_precision_score(y[i], p1[i]) - average_precision_score(y[i], p2[i]))
    return (float(average_precision_score(y, p1) - average_precision_score(y, p2)),
            float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5)))


# ------------------------------------------------------------------- figures ---
NICE = {"age_group": "Age group", TARGET: "COVID", **{k: stats.LABELS[k] for k in EXPOSURE + SYMPTOMS}}
COLORS = {"Expert BN": "#2563eb", "Learned BN": "#7c3aed", "Logistic regression": "#0d9488",
          "Constant baseline": "#94a3b8"}


def draw_dag(edges, title, path):
    g = nx.DiGraph(edges)
    g.add_nodes_from(VARIABLES)
    for layer, nodes in enumerate(nx.topological_generations(g)):
        for n in nodes:
            g.nodes[n]["layer"] = layer
    pos = nx.multipartite_layout(g, subset_key="layer", align="horizontal", scale=1)
    pos = {k: (x, -y) for k, (x, y) in pos.items()}
    fig, ax = plt.subplots(figsize=(15, 2.2 + 1.6 * (max(nx.get_node_attributes(g, "layer").values()) + 1)))
    kinds = {n: ("#2563eb" if n == TARGET else "#f59e0b" if n in EXPOSURE or n == "age_group" else "#dbeafe")
             for n in g}
    nx.draw_networkx_edges(g, pos, ax=ax, edge_color="#64748b", arrows=True, arrowsize=14, width=1.2,
                           node_size=2600, connectionstyle="arc3,rad=0.08")
    nx.draw_networkx_nodes(g, pos, ax=ax, node_color=[kinds[n] for n in g], node_size=2600,
                           edgecolors="#1e3a8a", linewidths=1)
    nx.draw_networkx_labels(g, pos, ax=ax, labels={n: NICE[n].replace(" ", "\n", 1) for n in g}, font_size=8,
                            font_color="#0f172a")
    nx.draw_networkx_labels(g, pos, ax=ax, labels={TARGET: "COVID"}, font_size=9, font_color="white",
                            font_weight="bold")
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold")
    ax.axis("off")
    ax.margins(0.06, 0.18)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def draw_calibration(y, preds: dict, path):
    fig, ax = plt.subplots(figsize=(6.4, 5.6))
    top = 0
    for name, p in preds.items():
        c = calibration(y, p)
        ax.plot(100 * c["mean_pred"], 100 * c["observed"], "o-", color=COLORS[name], label=name, lw=2, ms=6)
        top = max(top, 100 * c["mean_pred"].max(), 100 * c["observed"].max())
    ax.plot([0.05, top * 1.3], [0.05, top * 1.3], "--", color="#94a3b8", lw=1, label="Perfect calibration")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Mean predicted P(positive), % (deciles of predicted risk, log scale)")
    ax.set_ylabel("Observed positivity, % (log scale)")
    ax.set_title("Calibration on Sep–Oct 2020 tests", loc="left", fontweight="bold")
    ax.grid(alpha=.25)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def draw_pr(y, preds: dict, path):
    fig, ax = plt.subplots(figsize=(6.4, 5.2))
    for name, p in preds.items():
        pr, rc, _ = precision_recall_curve(y, p)
        ax.plot(100 * rc, 100 * pr, color=COLORS[name], lw=2,
                label=f"{name} (PR-AUC {average_precision_score(y, p):.3f})")
    ax.axhline(100 * y.mean(), color=COLORS["Constant baseline"], ls="--", lw=1,
               label=f"Constant baseline ({100 * y.mean():.2f}%)")
    ax.set_xlabel("Recall (share of positives found), %")
    ax.set_ylabel("Precision (share flagged that are positive), %")
    ax.set_title("Precision–recall on Sep–Oct 2020 tests", loc="left", fontweight="bold")
    ax.grid(alpha=.25)
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


# -------------------------------------------------------------------- report ---
def pct(x, nd=2):
    return f"{100 * x:.{nd}f}%"


def md_table(rows: list[list], head: list[str]) -> str:
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" if i == 0 else "---:" for i in range(len(head))) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def metric_rows(res: dict) -> list[list]:
    return [[k, f"{m['pr_auc']:.4f}", f"{m['roc_auc']:.3f}", f"{m['brier']:.5f}", pct(m["ece"], 3),
             pct(m["mean_pred"]), pct(m["observed"])] for k, m in res.items()]


METRIC_HEAD = ["Model", "PR-AUC", "ROC-AUC", "Brier", "ECE (10 bins)", "Mean predicted", "Observed"]


def cal_table(y, p) -> str:
    c = calibration(y, p)
    rows = [[int(r.bin), f"{pct(r.p_min)} – {pct(r.p_max)}", int(r.n), int(r.positives), pct(r.mean_pred),
             pct(r.observed), f"{r.observed / r.mean_pred:.2f}" if r.mean_pred else "–"] for r in c.itertuples()]
    return md_table(rows, ["Decile", "Predicted range", "Tests", "Positives", "Mean predicted", "Observed",
                           "Observed ÷ predicted"])


# ---------------------------------------------------------------------- main ---
def main():
    t0 = time.time()
    d, info = load()
    train_all, test = d[d["batch_date"] <= SPLIT], d[d["batch_date"] > SPLIT]
    train = complete(train_all)
    test_cc = complete(test)
    y_te, y_cc = y_of(test), y_of(test_cc)
    print(f"train {len(train):,} complete rows ({y_of(train).sum()} positive); test {len(test):,} rows")

    # Why exposure keeps an Unknown state: what complete-case on exposure would cost.
    sym_ok = train_all[SYMPTOMS].notna().all(axis=1)
    exp_unk = (train_all[EXPOSURE] == "Unknown").any(axis=1)
    lost = train_all[sym_ok & exp_unk]
    exposure_choice = {
        "train_rows_symptoms_complete": int(sym_ok.sum()),
        "rows_lost_if_exposure_required": int(len(lost)),
        "positives_lost": int(y_of(lost).sum()),
        "positives_total": int(y_of(train_all[sym_ok]).sum()),
        "positivity_lost_rows": float(y_of(lost).mean()) if len(lost) else None,
        "positivity_kept_rows": float(y_of(train_all[sym_ok & ~exp_unk]).mean()),
    }

    # Structures
    learned_edges = learn_structure(train)
    structures = {"Expert BN": EXPERT_EDGES, "Learned BN": learned_edges}
    print(f"learned {len(learned_edges)} edges")
    runs = {HASH_SEED: learned_edges, **{s_: learn_with_seed(s_) for s_ in STABILITY_SEEDS}}
    bic = BIC(train[VARIABLES], state_names=STATES)
    stability = []
    for seed, edges in runs.items():
        m = fit(edges, train)
        p = predict(m, test)
        stability.append({"seed": seed, "edges": len(edges), "bic": float(bic.score(m)),
                          "covid_children": sorted(m.get_children(TARGET)),
                          "covid_parents": sorted(m.get_parents(TARGET)),
                          "pr_auc": float(average_precision_score(y_te, p)), "ece": metrics(y_te, p)["ece"]})
    edge_freq = pd.Series([e_ for es in runs.values() for e_ in es]).value_counts()
    print("stability:", [(x["seed"], x["edges"], round(x["pr_auc"], 4)) for x in stability])
    draw_dag(EXPERT_EDGES, "Expert DAG", FIG / "dag_expert.png")
    draw_dag(learned_edges, "Learned DAG (hill climbing, BIC)", FIG / "dag_learned.png")

    models = {k: fit(e, train) for k, e in structures.items()}
    logit = Logistic(train)
    base = float(y_of(train).mean())

    preds = {k: predict(m, test) for k, m in models.items()}
    preds["Logistic regression"] = logit.predict(test)
    preds_cc = {k: p[test.index.get_indexer(test_cc.index)] for k, p in preds.items()}
    results = {k: metrics(y_te, p) for k, p in preds.items()}
    results["Constant baseline"] = metrics(y_te, np.full(len(test), base))
    results_cc = {k: metrics(y_cc, p) for k, p in preds_cc.items()}
    results_cc["Constant baseline"] = metrics(y_cc, np.full(len(test_cc), base))
    # Sensitivity: the same networks when an Unknown exposure answer is not used as evidence
    test_no_unk = test.copy()
    for v in EXPOSURE:
        test_no_unk[v] = test_no_unk[v].where(test_no_unk[v] != "Unknown", None)
    results_no_unk = {k: metrics(y_te, predict(m, test_no_unk)) for k, m in models.items()}
    print(f"evaluated in {time.time() - t0:.0f}s")

    # Choose: PR-AUC if the paired bootstrap says the gap is real, otherwise calibration (ECE, then Brier).
    diff = boot_diff(y_te, preds["Expert BN"], preds["Learned BN"])
    e, l = results["Expert BN"], results["Learned BN"]
    if diff[1] > 0 or diff[2] < 0:
        chosen = "Expert BN" if diff[0] > 0 else "Learned BN"
        reason = (f"PR-AUC differs reliably (Expert − Learned = {diff[0]:+.4f}, 95% bootstrap interval "
                  f"{diff[1]:+.4f} to {diff[2]:+.4f}), so PR-AUC decides.")
    else:
        chosen = "Expert BN" if (e["ece"], e["brier"]) <= (l["ece"], l["brier"]) else "Learned BN"
        reason = (f"PR-AUC is not reliably different (Expert − Learned = {diff[0]:+.4f}, 95% bootstrap interval "
                  f"{diff[1]:+.4f} to {diff[2]:+.4f}), so calibration decides: ECE {pct(e['ece'], 3)} (expert) vs "
                  f"{pct(l['ece'], 3)} (learned).")
    print("chosen:", chosen)

    draw_calibration(y_te, {k: preds[k] for k in ["Expert BN", "Learned BN", "Logistic regression"]},
                     FIG / "calibration.png")
    draw_pr(y_te, {k: preds[k] for k in ["Expert BN", "Learned BN", "Logistic regression"]}, FIG / "pr_curve.png")

    # Sanity check: loss of smell
    tr_y = y_of(train)
    emp = {s: float(tr_y[(train["loss_of_smell"] == s).to_numpy()].mean()) for s in YN}
    sanity = {k: {s: p_given(m, {"loss_of_smell": s}) for s in YN} for k, m in models.items()}
    sanity["Training data (empirical)"] = emp

    # Refit the winner on all complete rows, save, reload, compare
    full = complete(d)
    final = fit(structures[chosen], full)
    bif = DATA / "bayes_model.bif"
    final.save(str(bif), filetype="bif")
    loaded = DiscreteBayesianNetwork.load(str(bif), filetype="bif")
    probe = test.sample(2000, random_state=SEED)
    p_a, p_b = predict(final, probe), predict(loaded, probe)
    cpd_diff = max(float(np.abs(final.get_cpds(v).values - loaded.get_cpds(v).values).max()) for v in VARIABLES)
    roundtrip = {"rows_compared": len(probe), "max_prediction_diff": float(np.abs(p_a - p_b).max()),
                 "max_cpd_diff": cpd_diff, "same_edges": sorted(final.edges()) == sorted(loaded.edges()),
                 "same_states": all(final.get_cpds(v).state_names == loaded.get_cpds(v).state_names
                                    for v in VARIABLES)}
    roundtrip["ok"] = (roundtrip["max_prediction_diff"] < 1e-6 and roundtrip["same_edges"]
                       and roundtrip["same_states"])
    print("round trip:", roundtrip)
    final_smell = {s: p_given(final, {"loss_of_smell": s}) for s in YN}

    # Extra diagnostics used in the findings
    unk = test["high_risk_interactions"] == "Unknown"
    unk_tr = train["high_risk_interactions"] == "Unknown"
    diag = {
        "train_positivity": base, "test_positivity": float(y_te.mean()),
        "test_complete_rows": len(test_cc),
        "test_fever_missing": float(test["fever"].isna().mean()),
        "train_fever_missing": float(train_all["fever"].isna().mean()),
        "hri_unknown_share": {"train": float(unk_tr.mean()), "test": float(unk.mean())},
        "hri_unknown_positivity": {"train": float(tr_y[unk_tr.to_numpy()].mean()),
                                   "test": float(y_te[unk.to_numpy()].mean())},
        "hri_known_positivity": {"train": float(tr_y[~unk_tr.to_numpy()].mean()),
                                 "test": float(y_te[~unk.to_numpy()].mean())},
        "test_duplicate_share": float(test["is_exact_duplicate"].mean()),
        "results_unknown_not_evidence": results_no_unk,
        "distinct_predictions": {k: int(len(np.unique(p.round(6)))) for k, p in preds.items()},
        "top_decile": {k: calibration(y_te, p).iloc[-1][["mean_pred", "observed"]].to_dict() for k, p in preds.items()},
        "age_positivity_train": {a: float(tr_y[(train["age_group"] == a).to_numpy()].mean()) for a in AGE},
        "covid_markov_blanket_learned": sorted(models["Learned BN"].get_markov_blanket(TARGET)),
        "covid_parents_learned": sorted(models["Learned BN"].get_parents(TARGET)),
        "covid_children_learned": sorted(models["Learned BN"].get_children(TARGET)),
        "logistic_coefficients": logit.coefs(),
        "stability": stability,
        "edges_in_every_run": int((edge_freq == len(runs)).sum()),
        "edges_seen": int(len(edge_freq)),
        "expert_bic": float(bic.score(models["Expert BN"])),
    }

    meta = {
        "created": date.today().isoformat(),
        "pgmpy_version": __import__("pgmpy").__version__,
        "target": TARGET, "positive_state": "Positive",
        "variables": STATES,
        "age_group_labels": dict(zip(AGE, stats.AGE_GROUPS)),
        "chosen_structure": chosen, "choice_reason": reason,
        "edges": [list(e_) for e_ in sorted(final.edges())],
        "structures": {k: [list(e_) for e_ in v] for k, v in structures.items()},
        "training": {"rows_final_model": len(full), "positives_final_model": int(y_of(full).sum()),
                     "rows_train_split": len(train), "positives_train_split": int(tr_y.sum()),
                     "split": f"train batch_date <= {SPLIT.date()}, test Sep–Oct 2020",
                     "prior": "BDeu, equivalent_sample_size=10", **info},
        "overall_positivity": {"all_rows": float(y_of(d).mean()), "final_training_rows": float(y_of(full).mean()),
                               "train_split": base, "test_split": float(y_te.mean())},
        "test_metrics": {"all_test_rows": results, "complete_case_test_rows": results_cc,
                         "all_test_rows_unknown_exposure_not_evidence": results_no_unk},
        "pr_auc_diff_expert_minus_learned": {"estimate": diff[0], "ci95": [diff[1], diff[2]]},
        "sanity_loss_of_smell": {**sanity, "Final model": final_smell},
        "exposure_unknown_state": exposure_choice,
        "learned_structure_stability": {"hash_seed_used": HASH_SEED, "runs": diag["stability"],
                                        "edges_in_every_run": diag["edges_in_every_run"],
                                        "distinct_edges_seen": diag["edges_seen"]},
        "round_trip": roundtrip,
        "notes": ["Exposure answers that are missing are the state 'Unknown'.",
                  "Symptoms may be left out of the evidence when not recorded; never treat missing as 'No'."],
    }
    (DATA / "bayes_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    write_report(info, exposure_choice, structures, results, results_cc, y_te, preds, base, sanity, final_smell,
                 chosen, reason, full, roundtrip, diag, diff)
    print(f"done in {time.time() - t0:.0f}s")


def write_report(info, ec, structures, results, results_cc, y_te, preds, base, sanity, final_smell, chosen,
                 reason, full, rt, diag, diff):
    learned = set(structures["Learned BN"])
    expert = set(structures["Expert BN"])
    und = lambda es: {frozenset(e) for e in es}  # noqa: E731
    shared = und(learned) & und(expert)
    only_l = sorted(e for e in learned if frozenset(e) not in und(expert))
    only_e = sorted(e for e in expert if frozenset(e) not in und(learned))
    flipped = sorted(e for e in learned if frozenset(e) in und(expert) and e not in expert)
    fmt_e = lambda es: ", ".join(f"{a} → {b}" for a, b in es) or "none"  # noqa: E731

    r = results
    best_bn = max(["Expert BN", "Learned BN"], key=lambda k: r[k]["pr_auc"])
    lr, cb = r["Logistic regression"], r["Constant baseline"]
    lift = r[chosen]["pr_auc"] / cb["pr_auc"]
    ratio = r[chosen]["mean_pred"] / r[chosen]["observed"]
    sm = sanity[chosen]
    hu = diag["hri_unknown_positivity"]
    hk = diag["hri_known_positivity"]
    hs = diag["hri_unknown_share"]
    e_, l_ = r["Expert BN"], r["Learned BN"]
    ns, dp, td = diag["results_unknown_not_evidence"], diag["distinct_predictions"], diag["top_decile"]
    ages = diag["age_positivity_train"]
    pr_decided = diff[1] > 0 or diff[2] < 0
    st = diag["stability"]
    blanket = diag["covid_markov_blanket_learned"]
    age_kids = sorted(b for a_, b in learned if a_ == "age_group")
    exp_in = sorted(e for e in learned if e[1] in EXPOSURE)

    lines = [
        "# Bayesian network for COVID test results",
        "",
        f"_Generated by `modeling/train_bayes.py` on {date.today().isoformat()} with pgmpy "
        f"{__import__('pgmpy').__version__}._",
        "",
        "## Summary",
        "",
        f"- **Chosen structure: {chosen}.** {reason}",
        f"- On Sep–Oct 2020 tests it reaches PR-AUC **{r[chosen]['pr_auc']:.3f}** "
        f"({lift:.1f}× the constant baseline's {cb['pr_auc']:.4f}) and ROC-AUC **{r[chosen]['roc_auc']:.3f}**. "
        f"Logistic regression on the same variables: PR-AUC {lr['pr_auc']:.3f}, ROC-AUC {lr['roc_auc']:.3f}.",
        f"- Every model **over-predicts** in the test months: training positivity was {pct(base)}, test positivity "
        f"{pct(diag['test_positivity'])}. The chosen network's average prediction is {ratio:.1f}× the observed rate.",
        f"- The final model was refitted on all {len(full):,} complete rows and saved to "
        f"`backend/data/bayes_model.bif`; reloading it gives the same answers "
        f"(largest difference {rt['max_prediction_diff']:.1e} over {rt['rows_compared']:,} test rows).",
        "",
        "## 1. Data",
        "",
        md_table([
            ["Rows in clean.parquet", f"{info['rows_raw']:,}"],
            ["Dropped: age group Unknown", f"{info['dropped_unknown_age']:,}"],
            ["Dropped: true repeated records (exact duplicate and all six vitals present)",
             f"{info['dropped_true_duplicates']:,}"],
            ["Rows kept", f"{info['rows_used']:,}"],
            ["Training rows (≤ 2020-08-31, every symptom recorded)",
             f"{ec['train_rows_symptoms_complete']:,} ({ec['positives_total']} positive, {pct(base)})"],
            ["Test rows (Sep–Oct 2020, all)", f"{len(y_te):,} ({int(y_te.sum())} positive, "
                                              f"{pct(diag['test_positivity'])})"],
            ["Test rows with every symptom recorded", f"{diag['test_complete_rows']:,}"],
            ["Final model rows (all months, every symptom recorded)",
             f"{len(full):,} ({int(y_of(full).sum())} positive)"],
        ], ["", "Count"]),
        "",
        "Other exact duplicates are kept, as on the dashboard: without a patient ID they may be different people "
        f"with identical answers. They are common in the test months ({pct(diag['test_duplicate_share'], 0)} of "
        "test rows).",
        "",
        "**Missing answers.** Training uses only rows where every symptom is recorded; a missing symptom is never "
        "read as \"No\". At test time each row is scored with whatever it has: unrecorded symptoms are simply left "
        "out of the evidence, so the network averages over them. Fever is the gap that matters: it is missing in "
        f"{pct(diag['train_fever_missing'], 0)} of training-period rows but {pct(diag['test_fever_missing'], 0)} of "
        "test rows.",
        "",
        "**Why exposure has an Unknown state.** Requiring both exposure answers would drop "
        f"{ec['rows_lost_if_exposure_required']:,} of {ec['train_rows_symptoms_complete']:,} training rows "
        f"({pct(ec['rows_lost_if_exposure_required'] / ec['train_rows_symptoms_complete'], 1)}), but "
        f"{ec['positives_lost']} of {ec['positives_total']} positives "
        f"({pct(ec['positives_lost'] / ec['positives_total'], 1)}), because those rows are "
        f"{pct(ec['positivity_lost_rows'])} positive versus {pct(ec['positivity_kept_rows'])} for the rest. "
        "Losing an eighth of the positives, and the rows where they concentrate, costs too much, so each exposure "
        "variable is Yes / No / Unknown.",
        "",
        "## 2. Structures",
        "",
        "Both are fitted with `BayesianEstimator` (BDeu prior, equivalent sample size 10) on the training rows.",
        "",
        "**Expert DAG:** age group → COVID; both exposure variables → COVID; COVID → each of the 11 symptoms; "
        "loss of smell → loss of taste; cough → shortness of breath; age group → runny nose and sore throat.",
        "",
        "![Expert DAG](figures/dag_expert.png)",
        "",
        "**Learned DAG:** hill climbing with the BIC score; no edge may point into age group, and no symptom may "
        f"point into COVID. It found {len(learned)} edges (the expert DAG has {len(expert)}).",
        "",
        "![Learned DAG](figures/dag_learned.png)",
        "",
        md_table([
            ["Edges in both (either direction)", len(shared)],
            ["Learned only", fmt_e(only_l)],
            ["Expert only", fmt_e(only_e)],
            ["Same pair, opposite direction (learned)", fmt_e(flipped)],
            ["COVID's parents in the learned DAG", ", ".join(diag["covid_parents_learned"]) or "none"],
            ["COVID's children in the learned DAG", ", ".join(diag["covid_children_learned"]) or "none"],
        ], ["Comparison", "Edges"]),
        "",
        f"**How stable is the learned DAG?** Hill climbing breaks ties between equally good moves in an arbitrary "
        f"order (Python's string hashing). The saved model uses PYTHONHASHSEED={HASH_SEED}; the same search with "
        f"{len(STABILITY_SEEDS)} other seeds gives:",
        "",
        md_table([[("**" + x["seed"] + " (used)**") if x["seed"] == HASH_SEED else x["seed"], x["edges"],
                   f"{x['bic']:,.0f}", ", ".join(x["covid_parents"]) or "none", ", ".join(x["covid_children"]),
                   f"{x['pr_auc']:.4f}", pct(x["ece"], 3)] for x in diag["stability"]],
                 ["Seed", "Edges", "BIC (train)", "COVID's parents", "COVID's children", "Test PR-AUC", "Test ECE"]),
        "",
        f"{diag['edges_in_every_run']} edges appear in every run, out of {diag['edges_seen']} seen at least once. "
        f"For comparison, the expert DAG's BIC on the same data is {diag['expert_bic']:,.0f} (higher is better).",
        "",
        "## 3. Test results (Sep–Oct 2020)",
        "",
        "Score = P(COVID = Positive | every other recorded variable), by variable elimination. "
        "The constant baseline predicts the training positivity for everyone. Logistic regression uses the same "
        "variables (one-hot age group and Yes/No/Unknown exposure, symptoms 0/1); for symptoms missing at test "
        "time it uses the training average, not \"No\".",
        "",
        f"**All {len(y_te):,} test rows** (the main comparison):",
        "",
        md_table(metric_rows(results), METRIC_HEAD),
        "",
        f"**Only the {diag['test_complete_rows']:,} test rows with every symptom recorded** (no model has to deal "
        "with missing symptoms):",
        "",
        md_table(metric_rows(results_cc), METRIC_HEAD),
        "",
        "PR-AUC (average precision) is the main score because positives are rare; for the constant baseline it "
        "equals the positivity. Brier is the mean squared error of the probability. ECE is the average gap "
        "between predicted and observed positivity over the 10 bins below.",
        "",
        f"Paired bootstrap ({N_BOOT} resamples) of PR-AUC, expert − learned: {diff[0]:+.4f} "
        f"(95% interval {diff[1]:+.4f} to {diff[2]:+.4f}).",
        "",
        "**Sensitivity: the same networks, all test rows, when a missing exposure answer is left out of the "
        "evidence** instead of being entered as \"Unknown\":",
        "",
        md_table(metric_rows(diag["results_unknown_not_evidence"]), METRIC_HEAD),
        "",
        "![Precision–recall](figures/pr_curve.png)",
        "",
        "### Calibration (10 equal-size bins of predicted risk)",
        "",
        "![Calibration](figures/calibration.png)",
        "",
    ]
    for k in ["Expert BN", "Learned BN", "Logistic regression"]:
        lines += [f"**{k}**", "", cal_table(y_te, preds[k]), ""]
    lines += [
        f"**Constant baseline:** predicts {pct(base)} for all {len(y_te):,} tests; observed "
        f"{pct(diag['test_positivity'])}.",
        "",
        "## 4. Sanity check: loss of smell",
        "",
        md_table([[k, pct(v["Yes"]), pct(v["No"]), f"{v['Yes'] / v['No']:.1f}×"]
                  for k, v in {**sanity, "Final model (all data)": final_smell}.items()],
                 ["Source", "P(positive | loss of smell = Yes)", "P(positive | No)", "Ratio"]),
        "",
        f"Both networks reproduce the direction and size of the training data's effect "
        f"({pct(sm['Yes'])} vs {pct(sm['No'])} for the chosen model).",
        "",
        "## 5. Final model",
        "",
        md_table([
            ["Structure", chosen],
            ["Rows / positives", f"{len(full):,} / {int(y_of(full).sum())}"],
            ["Saved", "`backend/data/bayes_model.bif`, `backend/data/bayes_meta.json`"],
            ["Reload: same edges", "yes" if rt["same_edges"] else "**no**"],
            ["Reload: same states", "yes" if rt["same_states"] else "**no**"],
            ["Reload: largest CPD difference", f"{rt['max_cpd_diff']:.1e}"],
            ["Reload: largest prediction difference", f"{rt['max_prediction_diff']:.1e} "
                                                       f"({rt['rows_compared']:,} test rows)"],
        ], ["", ""]),
        "",
        "Age states in the file are ASCII (`0-18`, `19-30`, `31-45`, `46-60`, `61+`); `bayes_meta.json` maps them "
        "to the dashboard labels.",
        "",
        "## 6. Findings in plain English",
        "",
        f"1. **Symptoms give a real but modest signal.** The chosen network ranks Sep–Oct tests about "
        f"{lift:.0f}× better than guessing (PR-AUC {r[chosen]['pr_auc']:.3f} vs {cb['pr_auc']:.4f}), yet even its "
        f"riskiest tenth of tests is only {pct(td[chosen]['observed'])} positive. This is a triage aid, not a "
        f"diagnosis. Loss of smell is the clearest single sign: {pct(sm['Yes'])} positive when present vs "
        f"{pct(sm['No'])} when absent, which both networks reproduce.",
        (f"2. **The learned DAG ranks the riskiest tests better; the expert DAG ranks the bulk better.** "
         if pr_decided else "2. **Neither network clearly beats the other on PR-AUC.** ")
        + f"PR-AUC {l_['pr_auc']:.3f} learned vs {e_['pr_auc']:.3f} expert (bootstrap interval of the gap "
        f"{diff[1]:+.3f} to {diff[2]:+.3f}); ROC-AUC {l_['roc_auc']:.3f} vs {e_['roc_auc']:.3f}. "
        + ("The interval excludes zero, so PR-AUC picked the " if pr_decided else "So calibration picked the ")
        + f"{chosen.split()[0].lower()} DAG. Logistic regression on the same variables lands at PR-AUC "
        f"{lr['pr_auc']:.3f}, ROC-AUC {lr['roc_auc']:.3f}: the network is not more accurate than a simple "
        "regression; its advantage is answering any partial question (\"only age and cough are known\") and "
        "handling missing answers without retraining.",
        f"3. **In the learned network nothing points into COVID.** Age and exposure have no direct link to it; "
        f"COVID depends only on its Markov blanket ({', '.join(blanket)}). Age points to "
        f"{', '.join(age_kids) or 'nothing'}"
        + (", so it enters only as a co-parent of a COVID symptom" if "age_group" in blanket else "")
        + f". The exposure variables sit below symptoms ({fmt_e(exp_in)}): associations the score found useful, "
        f"not causes. Training positivity by age ranges only {pct(min(ages.values()))}–{pct(max(ages.values()))}, too "
        "little for BIC to pay for a 5-state parent once symptoms are known. A side effect: the learned network "
        f"outputs just {dp['Learned BN']:,} distinct probabilities across {len(y_te):,} tests (median "
        f"{pct(np.median(preds['Learned BN']))}).",
        f"4. **The probabilities run high for the test months.** Positivity fell from {pct(base)} in Apr–Aug to "
        f"{pct(diag['test_positivity'])} in Sep–Oct; a model trained on the earlier months carries the higher base "
        f"rate forward (mean prediction {pct(r[chosen]['mean_pred'])}). Ranking survives this shift; the absolute "
        "numbers do not. The saved model is refitted on all months, which lowers its base rate, but any live use "
        "should recalibrate to recent positivity.",
        f"5. **\"Unknown\" exposure flips meaning over time, and it hurts the expert DAG.** In training, a missing "
        f"high-risk-interactions answer ({pct(hs['train'], 0)} of rows) went with {pct(hu['train'])} positivity vs "
        f"{pct(hk['train'])} when answered, because answers were most often missing in April–May when positivity was "
        f"highest. In Sep–Oct the answer is missing in {pct(hs['test'], 0)} of rows and those rows are only "
        f"{pct(hu['test'])} positive (vs {pct(hk['test'])}). The expert DAG, where exposure points straight at COVID, "
        f"raises risk for all of them. Leaving Unknown out of the evidence moves its ECE from {pct(e_['ece'], 3)} to "
        f"{pct(ns['Expert BN']['ece'], 3)} and its PR-AUC from {e_['pr_auc']:.3f} to {ns['Expert BN']['pr_auc']:.3f}. "
        "The learned DAG barely notices because exposure is screened off by the symptoms. For live use, treat a "
        "missing exposure answer as missing evidence, not as \"Unknown\".",
        f"6. **Fever is often unrecorded in the test months** ({pct(diag['test_fever_missing'], 0)} vs "
        f"{pct(diag['train_fever_missing'], 0)} in training). On the {diag['test_complete_rows']:,} test rows with every "
        f"symptom recorded all models score higher (chosen network PR-AUC {results_cc[chosen]['pr_auc']:.3f}, "
        f"ROC-AUC {results_cc[chosen]['roc_auc']:.3f}), and those rows are also more often positive "
        f"({pct(results_cc[chosen]['observed'])} vs {pct(diag['test_positivity'])}).",
        f"7. **The learned structure is not stable.** Re-running the same search with different tie-breaking "
        f"gives {min(x['edges'] for x in st)}–{max(x['edges'] for x in st)} edges, only "
        f"{diag['edges_in_every_run']} of {diag['edges_seen']} edges in every run, COVID with "
        f"{min(len(x['covid_children']) for x in st)}–{max(len(x['covid_children']) for x in st)} children, and test "
        f"PR-AUC from {min(x['pr_auc'] for x in st):.3f} to {max(x['pr_auc'] for x in st):.3f}. Many symptom-to-"
        "symptom arrows are interchangeable ways of encoding the same correlations, so do not read individual "
        "learned arrows as findings. The seed is pinned so the saved model is reproducible.",
    ]
    (OUT / "bayes_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--learn-only" not in sys.argv and os.environ.get("PYTHONHASHSEED") != HASH_SEED:  # reproducible DAG
        sys.exit(subprocess.run([sys.executable, __file__, *sys.argv[1:]],
                                env={**os.environ, "PYTHONHASHSEED": HASH_SEED}).returncode)
    if "--learn-only" in sys.argv:
        data, _ = load()
        print(json.dumps(learn_structure(complete(data[data["batch_date"] <= SPLIT]))))
    else:
        main()
