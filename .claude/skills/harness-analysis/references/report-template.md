<!--
HAF-1 report template. Keep every section, in this order, even when a section is short: the fixed shape is what makes
two reports comparable. Write in the language the user asked in; keep IDs, kinds, triggers and actions in English.
-->

# Harness analysis — <repo> (HAF-1)

<date> · commit `<sha>` · tools: <claude-code, cursor, …>

## 1. Verdict

<3–5 sentences: profile, overall score, the one thing this harness does best, the one gap that matters most.>

| Overall   | Profile        | Points    | Components | Hard-enforced |
| --------- | -------------- | --------- | ---------- | ------------- |
| <x.x> / 4 | <Level> (L<n>) | <e>/<max> | <n>        | <p>%          |

## 2. How it works

<One diagram (mermaid flowchart or ASCII) of the agent loop through the control points C1…C12, showing which
component acts at each point and what it can do (deny / ask / block / fix / report). Then 5–8 bullets that walk one
unit of work from start to merge.>

## 3. Component inventory

| Component | Kind | Trigger | Responsibility | Actions | Enforcement | Pillars | Evidence |
| --------- | ---- | ------- | -------------- | ------- | ----------- | ------- | -------- |

## 4. Control-point coverage

| #   | Control point | Components acting here | Strongest action |
| --- | ------------- | ---------------------- | ---------------- |
| C1  | session-start |                        |                  |
| …   | …             |                        |                  |
| C12 | review        |                        |                  |

## 5. Scorecard

### 5.1 Pillars

| Pillar | Score | Summary |
| ------ | ----- | ------- |

### 5.2 Criteria

| ID  | Criterion | Score | Evidence | Note |
| --- | --------- | ----- | -------- | ---- |

## 6. Gaps and opportunities

<Every criterion < 3, sorted by score then pillar order, plus any 3 that has a documented hole.>

| #   | Criterion | Score | Gap (what is missing) | Next step | Effort (S/M/L) |
| --- | --------- | ----- | --------------------- | --------- | -------------- |

## 7. Strengths worth porting

<Components another repo could copy as-is: what, why it works, the files to copy.>

## 8. Comparison hooks

- Scorecard: `<path>/harness-scorecard.json` (validate with `compare_scorecards.py validate`)
- Compare: `python3 <skill>/scripts/compare_scorecards.py compare <this>.json <other>.json`
