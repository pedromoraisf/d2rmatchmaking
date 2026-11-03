#!/usr/bin/env python3
"""Score and compare Harness Analysis Framework (HAF-1) scorecards. Stdlib only.

  compare_scorecards.py summary A.json            # pillar scores, profile, gaps of one repo
  compare_scorecards.py validate A.json           # check the scorecard is complete (exit 1 if not)
  compare_scorecards.py compare A.json B.json     # side-by-side deltas, coverage, transferable components

Output is Markdown, ready to paste into a report.
"""
import json
import math
import sys

PILLARS = [
    ("CTX", "Context & Guides"),
    ("MET", "Method & Traceability"),
    ("ORQ", "Orchestration & Roles"),
    ("GRD", "Action Guardrails"),
    ("SEN", "Sensors & Feedback"),
    ("VER", "Test Integrity & Verification"),
    ("REM", "Remote Barriers"),
    ("EST", "State, Memory & Resumption"),
    ("GOV", "Autonomy Governance"),
    ("EVO", "Measurement & Evolution"),
]
CRITERIA = [f"{p}-{i}" for p, _ in PILLARS for i in range(1, 5)]
LEVELS = ["Absent", "Ad hoc", "Documented", "Enforced", "Self-correcting"]
CONTROL_POINTS = [
    "session-start", "plan", "pre-tool", "on-edit", "turn-end", "pre-commit",
    "pre-push", "ci-pr", "merge", "release", "scheduled", "review",
]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate(card):
    errors = []
    if card.get("framework") != "HAF-1":
        errors.append('framework must be "HAF-1"')
    crit = card.get("criteria", {})
    for cid in CRITERIA:
        c = crit.get(cid)
        if c is None:
            errors.append(f"{cid}: missing")
            continue
        s = c.get("score")
        if s != "N/A" and not (isinstance(s, int) and 0 <= s <= 4):
            errors.append(f"{cid}: score must be 0-4 or N/A")
        if s not in (0, "N/A") and not c.get("evidence"):
            errors.append(f"{cid}: score {s} needs evidence")
        if isinstance(s, int) and s < 3 and not c.get("next_step"):
            errors.append(f"{cid}: a gap (score < 3) needs next_step")
    for cid in crit:
        if cid not in CRITERIA:
            errors.append(f"{cid}: unknown criterion")
    cov = card.get("coverage", {})
    for cp in CONTROL_POINTS:
        if cp not in cov:
            errors.append(f"coverage.{cp}: missing (use [] for a gap)")
    return errors


def scores(card):
    crit = card["criteria"]
    pillar = {}
    for p, _ in PILLARS:
        vals = [crit[f"{p}-{i}"]["score"] for i in range(1, 5)]
        vals = [v for v in vals if v != "N/A"]
        pillar[p] = round(sum(vals) / len(vals), 1) if vals else None
    applicable = [v for v in pillar.values() if v is not None]
    overall = round(sum(applicable) / len(applicable), 1) if applicable else 0.0
    earned = sum(c["score"] for c in crit.values() if c["score"] != "N/A")
    maximum = 4 * sum(1 for c in crit.values() if c["score"] != "N/A")
    level = min(math.floor(overall), math.floor(min(applicable)) + 1 if applicable else 0)
    inv = card.get("inventory", [])
    hard = sum(1 for x in inv if x.get("enforcement") == "hard")
    return {
        "pillar": pillar,
        "overall": overall,
        "earned": earned,
        "max": maximum,
        "level": level,
        "profile": LEVELS[level],
        "hard_ratio": round(100 * hard / len(inv)) if inv else 0,
        "components": len(inv),
    }


def gaps(card):
    order = {p: i for i, (p, _) in enumerate(PILLARS)}
    rows = [
        (cid, c) for cid, c in card["criteria"].items()
        if c["score"] != "N/A" and c["score"] < 3
    ]
    rows.sort(key=lambda r: (r[1]["score"], order[r[0][:3]], r[0]))
    return rows


def summary(card):
    s = scores(card)
    out = [
        f"## {card['repo']} — HAF-1 summary",
        "",
        f"- Overall: **{s['overall']} / 4** ({s['earned']}/{s['max']} points) · profile **{s['profile']}** (L{s['level']})",
        f"- Components: {s['components']} · hard-enforced: {s['hard_ratio']}%",
        "",
        "| Pillar | Score | Bar |",
        "| --- | --- | --- |",
    ]
    for p, name in PILLARS:
        v = s["pillar"][p]
        bar = "N/A" if v is None else "█" * round(v * 2) + "░" * (8 - round(v * 2))
        out.append(f"| {p} · {name} | {v if v is not None else 'N/A'} | `{bar}` |")
    out += ["", "### Gaps (score < 3)", "", "| Criterion | Score | Next step |", "| --- | --- | --- |"]
    for cid, c in gaps(card):
        out.append(f"| {cid} | {c['score']} | {c.get('next_step', '')} |")
    empty = [cp for cp in CONTROL_POINTS if not card.get("coverage", {}).get(cp)]
    out += ["", f"Uncovered control points: {', '.join(empty) if empty else 'none'}"]
    return "\n".join(out)


def compare(a, b):
    sa, sb = scores(a), scores(b)
    na, nb = a["repo"], b["repo"]
    out = [
        f"## {na} vs {nb} — HAF-1 comparison",
        "",
        f"| | {na} | {nb} | Δ (B−A) |",
        "| --- | --- | --- | --- |",
        f"| Overall | {sa['overall']} | {sb['overall']} | {round(sb['overall'] - sa['overall'], 1):+} |",
        f"| Profile | {sa['profile']} | {sb['profile']} | |",
        f"| Hard-enforced components | {sa['hard_ratio']}% | {sb['hard_ratio']}% | {sb['hard_ratio'] - sa['hard_ratio']:+} pp |",
        "",
        "### Pillars",
        "",
        f"| Pillar | {na} | {nb} | Δ | Stronger |",
        "| --- | --- | --- | --- | --- |",
    ]
    for p, name in PILLARS:
        va, vb = sa["pillar"][p], sb["pillar"][p]
        if va is None or vb is None:
            out.append(f"| {p} · {name} | {va} | {vb} | N/A | |")
            continue
        d = round(vb - va, 1)
        who = "" if abs(d) < 1 else (nb if d > 0 else na)
        out.append(f"| {p} · {name} | {va} | {vb} | {d:+} | {who} |")
    out += ["", "### Criteria with a gap of 2 or more", "", f"| Criterion | {na} | {nb} | Port from |", "| --- | --- | --- | --- |"]
    transfer = []
    for cid in CRITERIA:
        xa, xb = a["criteria"][cid]["score"], b["criteria"][cid]["score"]
        if "N/A" in (xa, xb):
            continue
        if abs(xa - xb) >= 2:
            src = a if xa > xb else b
            out.append(f"| {cid} | {xa} | {xb} | {src['repo']} |")
        if xa != xb:
            src, dst = (a, b) if xa > xb else (b, a)
            comps = [x["component"] for x in src.get("inventory", []) if cid in x.get("pillars", [])]
            if comps:
                transfer.append((cid, src["repo"], dst["repo"], comps))
    out += ["", "### Control-point coverage", "", f"| Control point | {na} | {nb} |", "| --- | --- | --- |"]
    for cp in CONTROL_POINTS:
        ca, cb = len(a.get("coverage", {}).get(cp, [])), len(b.get("coverage", {}).get(cp, []))
        mark = lambda n: "—" if n == 0 else str(n)
        out.append(f"| {cp} | {mark(ca)} | {mark(cb)} |")
    out += ["", "### Transferable components", "", "| Criterion | From → To | Components |", "| --- | --- | --- |"]
    for cid, src, dst, comps in transfer:
        out.append(f"| {cid} | {src} → {dst} | {', '.join(comps)} |")
    return "\n".join(out)


def main(argv):
    if len(argv) < 3 or argv[1] not in ("summary", "validate", "compare"):
        print(__doc__)
        return 2
    cmd = argv[1]
    cards = [load(p) for p in argv[2:]]
    for path, card in zip(argv[2:], cards):
        errs = validate(card)
        if errs:
            print(f"{path}: {len(errs)} problem(s)", file=sys.stderr)
            for e in errs:
                print(f"  - {e}", file=sys.stderr)
            if cmd != "summary":
                return 1
    if cmd == "validate":
        print("ok")
    elif cmd == "summary":
        print(summary(cards[0]))
    else:
        if len(cards) != 2:
            print("compare needs two scorecards", file=sys.stderr)
            return 2
        print(compare(cards[0], cards[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
