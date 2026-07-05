# Kira micro-benchmark

A dependency-free micro-benchmark for the two hot paths an agent hits on every
call: `lookup` (keyword → skills + scars) and `resolveRoute` (goal → ordered
steps). It exists to **catch performance regressions**, not to produce a leaderboard.

```bash
npm run bench
```

The harness loads the real corpus from `skills/` and `routes/`, times each
scenario, and compares the **median** latency against a per-scenario budget.
If any scenario is over budget it prints the offenders and exits non-zero, so a
regression trips a pre-commit gate or a manual run.

## How it works

- Runs via `vite-node` (already a transitive dev dependency of `vitest`), so no
  build step and no extra install — it benchmarks `src/` directly.
- Each scenario is warmed up for 100 ms to let V8's JIT settle, then timed in
  self-calibrating batches sized to ~5 ms each so per-op numbers stay stable
  across machines. `p95` is shown for insight; the budget is gated on the median.
- No network, no filesystem writes — pure in-process measurement.

Override the sample count for a steadier (slower) or quicker (noisier) run:

```bash
KIRA_BENCH_SAMPLES=200 npm run bench
```

## Budget thresholds

Budgets are **regression tripwires**, deliberately set ~4–5× above the reference
baseline so they fire on algorithmic regressions (e.g. an accidental O(n²)
matcher) rather than on ordinary machine-to-machine jitter. Median must stay
under the budget for the run to pass.

| Scenario                    | What it exercises                              | Budget (median) |
| --------------------------- | ---------------------------------------------- | --------------- |
| `lookup · hit + context`    | Warm hit, filtered by a project context        | 250 µs/op       |
| `lookup · hit, no context`  | Hit with no context filter (scans every item)  | 250 µs/op       |
| `lookup · miss + suggest`   | Miss → fallback suggestion scan over all skills | 600 µs/op       |
| `route · light (2 steps)`   | Goal → 2 steps, each resolved via `lookup`      | 500 µs/op       |
| `route · heavy (11 steps)`  | Heaviest goal → 11 steps; `lookup` amplified    | 2500 µs/op      |
| `route · miss`              | No matching route (cheapest path)              | 200 µs/op       |

### Reference baseline

Measured medians on the reference machine (AMD Threadripper 3960X, Node 20, via
`vite-node`). Your absolute numbers will differ; the budgets have headroom for
that. A run whose median lands anywhere near its budget is the signal to
investigate — not to raise the ceiling.

| Scenario                    | Reference median | Headroom to budget |
| --------------------------- | ---------------- | ------------------ |
| `lookup · hit + context`    | ~47 µs/op        | ~5×                |
| `lookup · hit, no context`  | ~47 µs/op        | ~5×                |
| `lookup · miss + suggest`   | ~165 µs/op       | ~3.6×              |
| `route · light (2 steps)`   | ~96 µs/op        | ~5×                |
| `route · heavy (11 steps)`  | ~546 µs/op       | ~4.6×              |
| `route · miss`              | ~2 µs/op         | large (sanity cap) |

### Adjusting budgets

Edit the `budget` argument in the corresponding `bench(...)` call in
`bench/lookup.bench.ts`. Raise a budget only when a deliberate, understood change
shifts the baseline (e.g. the corpus grows substantially) — never to silence a
regression you haven't explained.
