"""The numbers behind the hero's live demo, computed the way the demo's cells say they are.

Builds the same generated phase II trial as the desktop app's ?demo&hero notebook, adds a dose date, early stops
and arm switches, and runs every variant a visitor can reach. Writes src/components/demo/data.json.

    python -m venv .venv && .venv/bin/pip install pandas lifelines
    .venv/bin/python scripts/demo-data.py
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import logrank_test

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent.parent / "src/components/demo/data.json"
ARMS = ["New regimen", "Standard care"]


def patients():
    # Seed 309 gives medians of about 31 and 22 months, as the hero notebook shows
    r = np.random.default_rng(309)
    parts = []
    for arm, median in [("New regimen", 31.2), ("Standard care", 22.4)]:
        n = 206
        age = np.clip(r.normal(63, 9, n).round(), 34, 86).astype(int)
        stage = r.choice(["I", "II", "III"], n, p=[0.25, 0.45, 0.30])
        risk = np.exp(np.select([stage == "I", stage == "III"], [-0.45, 0.5], 0) + 0.02 * (age - 63))
        t = r.exponential(median / np.log(2), n) / risk
        drop = r.exponential(160, n)
        cut = 48 - r.uniform(0, 18, n)  # staggered entry: follow-up ends 30 to 48 months after randomisation
        months = np.minimum.reduce([t, drop, cut])
        died = (t <= np.minimum(drop, cut)).astype(int)
        parts.append(pd.DataFrame({"arm": arm, "age": age, "stage": stage, "months": months.round(1), "died": died}))
    df = pd.concat(parts, ignore_index=True)
    df.insert(0, "id", [f"P{i:04d}" for i in range(1, len(df) + 1)])

    # What the demo adds, from its own seed, so the columns above stay exactly as the notebook has them
    x = np.random.default_rng(2026)
    df["dose_delay_days"] = x.integers(3, 46, len(df))
    df["stopped_early"] = x.random(len(df)) < 0.10
    df["reason"] = np.where(df.stopped_early, x.choice(["toxicity", "progression", "withdrew"], len(df), p=[0.46, 0.34, 0.20]), None)
    # 31 patients on standard care crossed to the new regimen after progression, 5 of them among those who stopped
    # early for it, so counting them per protocol changes the answer
    standard = df[df.arm == "Standard care"]
    stopped_for_progression = standard[standard.reason == "progression"].sample(5, random_state=7).index
    others = standard[(standard.died == 1) & ~standard.stopped_early].sample(26, random_state=7).index
    df["switched"] = df.index.isin(stopped_for_progression.union(others))
    return df


def steps(fit):
    """The Kaplan-Meier curve as [month, survival] steps, and the censored points on it."""
    sf = fit.survival_function_.iloc[:, 0]
    curve = [[round(float(t), 2), round(float(s), 4)] for t, s in sf.items()]
    return curve


def survival(df, origin, population):
    data = df.copy()
    if origin == "first dose":
        data["months"] = (data.months - data.dose_delay_days / 30.44).clip(lower=0)
    if population == "patients over 65":
        data = data[data.age > 65]
    elif population == "stage III patients":
        data = data[data.stage == "III"]
    arms = []
    groups = {arm: data[data.arm == arm] for arm in ARMS}
    for arm in ARMS:
        g = groups[arm]
        fit = KaplanMeierFitter().fit(g.months, g.died)
        censored = g[g.died == 0].months
        arms.append(
            {
                "label": arm,
                "n": int(len(g)),
                "median": None if np.isinf(fit.median_survival_time_) else round(float(fit.median_survival_time_), 1),
                "steps": steps(fit),
                "censored": [[round(float(m), 2), round(float(fit.predict(m)), 4)] for m in censored],
            }
        )
    a, b = groups["New regimen"], groups["Standard care"]
    p = {
        "log-rank test": float(logrank_test(a.months, b.months, a.died, b.died).p_value),
        "Wilcoxon test": float(logrank_test(a.months, b.months, a.died, b.died, weightings="wilcoxon").p_value),
    }
    return {"n": int(len(data)), "arms": arms, "p": p}


def hazards(df):
    model = df.assign(
        new_regimen=(df.arm == "New regimen").astype(int),
        stage_II=(df.stage == "II").astype(int),
        stage_III=(df.stage == "III").astype(int),
    )[["months", "died", "new_regimen", "age", "stage_II", "stage_III"]]
    s = CoxPHFitter().fit(model, "months", "died").summary
    cols = ["exp(coef)", "exp(coef) lower 95%", "exp(coef) upper 95%", "p"]
    return {"index": list(s.index), "columns": ["hazard_ratio", "ci_lower", "ci_upper", "p"], "rows": [[round(float(v), 3) for v in row] for row in s[cols].values]}


def stopped(df, counting):
    data = df if counting == "intention to treat" else df[~df.switched]
    s = data[data.stopped_early]
    table = s.groupby(["reason", "arm"]).size().unstack(fill_value=0).reindex(index=["toxicity", "progression", "withdrew"], columns=ARMS, fill_value=0)
    return {
        "patients": int(len(data)),
        "stopped": int(len(s)),
        "reasons": table.index.tolist(),
        "counts": {arm: [int(v) for v in table[arm]] for arm in ARMS},
    }


df = patients()
data = {
    "patients": int(len(df)),
    "switched": int(df.switched.sum()),
    "survival": {
        origin: {population: survival(df, origin, population) for population in ["all patients", "patients over 65", "stage III patients"]}
        for origin in ["randomisation", "first dose"]
    },
    "hazards": hazards(df),
    "stopped": {counting: stopped(df, counting) for counting in ["intention to treat", "per protocol"]},
}
OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
for origin, pops in data["survival"].items():
    for pop, s in pops.items():
        print(origin, "|", pop, s["n"], [a["median"] for a in s["arms"]], {k: round(v, 4) for k, v in s["p"].items()})
print(data["hazards"]["rows"][0])
print(json.dumps(data["stopped"]))
