---
created: 2026-06-09T12:30:00Z
branch: docs/eval-retrospective
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: active
---

# Variance is the metric

## Frame

When you benchmark a small language model, the first number you get is not a
measurement — it is one sample from a distribution you have not yet characterized. The
discipline that makes an eval trustworthy is not a cleverer scorer or a bigger golden
set. It is reporting **variance**, and deciding in advance which metrics are allowed to
be noisy. An eval that emits a single accuracy figure with no spread is not measuring
the agent; it is flattering or maligning it at random.

## A single run is a point estimate with no error bar

A frontier model at temperature 0 is nearly a function: same input, same output. A
small model — quantized, sampled, often running a hidden "thinking" pass — is a random
variable. Run the same golden set three times and items flip pass↔fail not because the
agent changed but because the draw did. We watched one agent read **89.5%** on its first
run and **56.5%** on its next two, with no code change between the first two
measurements that mattered. Neither number was "the score." The score was a
distribution whose mean was near 65% with a standard deviation of a few points, and the
only way to see that was to run K times and report mean ± stdev. The cost of skipping
this is not imprecision; it is *narrative*. Two noise draws become a "regression," a
"breakthrough," a story — and you spend a week optimizing toward a mirage.

## Hard gates and soft signals are different kinds of number

Not all metrics carry the same noise. Decompose what the agent does and some parts are
stable, others volatile:

- **Tool-selection** (did it call the right tools) and **groundedness** (did it call any
  tool before asserting a fact) were rock-stable across a 49→94% accuracy swing — they
  moved within ±0.02–0.04. They reflect a near-deterministic routing decision.
- **Text accuracy** (does the prose contain the right value, labeled correctly) was the
  volatile one — sensitive to phrasing, to the model's "thinking" budget, to whether the
  answer truncated an address.

Treat these as different instruments. The stable ones are **hard gates**: a real drop
is a real regression; block the merge. The volatile one is a **soft signal**: watch its
trend and its per-item pass-rate, but never let a single noisy accuracy number gate a
decision. We had this backwards at first — we trusted the dramatic accuracy number and
ignored the boringly-stable gates that were, in fact, telling the truth the whole time.

## The scorer is part of the system under test

The eval is not a neutral observer; it is code with its own bugs, and its bugs
masquerade as the agent's. Half of our early "failures" were the scorer matching a full
40-hex address against an answer that wrote `0xaceaa7…`, or requiring the literal word
"blue" from a correct explanation of GHOSTDAG that said "selected parent." The fix was
not in the agent. **Calibrate the instrument before you trust its readings** — against a
handful of hand-graded transcripts — exactly as you would zero a scale before weighing.

## What this implies

- Report **mean ± stdev over N≥3 runs** for any model that samples. Make the stdev a
  first-class output, not a footnote. If the stdev is large, that *is* the finding.
- Separate **hard gates** (stable, gating) from **soft signals** (noisy, observational).
  Gate merges on the gates; trend the signals.
- Expose the **per-item pass-rate and a flaky list**, so a 70% isn't a uniform fog but a
  precise map of which capabilities are reliable and which are coin-flips.
- **Calibrate the scorer** before believing it. A regression that hits everything is far
  more likely a measurement change than a capability change.
- The most valuable number an eval produces is often the **honest low one** — the first
  figure you can actually stand on.

## What this does NOT imply

- Not "small models are too noisy to benchmark." They are perfectly benchmarkable; you
  just have to measure the distribution instead of a point.
- Not "accuracy doesn't matter." It is the goal; it is simply the *noisiest* proxy for
  it, so it must be averaged and read alongside the stable gates.
- Not "more runs forever." N=3–5 is usually enough to separate signal from draw; the
  point is a spread, not a census.
- This is about evaluation methodology, not a claim that variance is the only thing that
  matters about a model.

## References

- Case study: [`../case_studies/2026-06-09-the-4k-wall.md`](../case_studies/2026-06-09-the-4k-wall.md)
- Journal: [`../journals/2026-06-09-the-eval-graded-my-assumptions.md`](../journals/2026-06-09-the-eval-graded-my-assumptions.md)
- Harness: `src/lib/eval/scorers.ts` (meanStdev, aggregateRuns, hard-vs-soft); `scripts/eval/`.
