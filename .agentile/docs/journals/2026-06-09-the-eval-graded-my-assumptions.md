---
created: 2026-06-09T12:30:00Z
branch: docs/eval-retrospective
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-1..RA-8
status: active
---

# The eval graded my assumptions, not the agent

## Context

We set out to take "Ask CitrateScan" from *working* to *wow*. Eval-first: build a
benchmark before touching the agent, so every change is a measured experiment. I
expected the harness to grade the agent. It spent most of the week grading me.

## What happened

The first baseline read **89.5%**. It felt like success — the agent was good, just
needed richer tools. I shipped the hash-free value query (RA-2) and re-measured:
**56.5%**, and the same number on a second run. A regression, apparently — half the
items that had passed now "failed."

Except when I read *how* they failed, most had called the *correct* tool; only the
prose varied, and a few answers came back **empty**. So I'd been wrong twice in one
hour: the 89.5% wasn't the agent's true score (it was a lucky single sample), and the
56.5% "regression" wasn't a regression (it was variance plus brittle string-matching in
my own scorer). I had been comparing two noise draws and reading a story into them.

So I stopped improving the agent and hardened the eval instead (RA-1.5): average over
N runs, report the stdev, score addresses tolerant of the truncation the model
actually emits (`0xaceaa7…`), and treat tool-selection + groundedness as the hard gates
with text-accuracy as a soft signal. The honest number was **~65% ± 3.5** — neither
89 nor 56.

Then the agent kept returning empty answers on exactly the queries that called a tool.
I had a tidy theory: small models are flaky narrators. I was about to write that down
as a known limitation. The actual cause arrived as an offhand line from Saul: *"the
context window is tiny — I got an error around 4k tokens."* I measured the fixed
overhead — system prompt plus the 20 tool schemas — and it was **~4,840 tokens, before
the user typed anything.** The served model context was 4,096. The agent could never
fit; it called a tool and then had no room left to answer. The "model quirk" was a
serving-config line: `--ctx-size 8192 --parallel 2` → 4,096 per request. Raising it to
the model's real 128K took accuracy to **94.2% ± 2.0**, and the variance collapsed —
because the model finally had room to be consistent.

## What I learned

- **A single eval run is a number-shaped opinion.** For a small model it is dominated
  by sampling noise; without a stdev I can't tell signal from draw. The 89.5% nearly
  sent me down a months-long "improve the agent" path that would have measured nothing.
- **My scorer was part of the system under test.** Half the early "failures" were the
  scorer being literal about addresses and phrasing, not the agent being wrong. The
  measuring instrument needs its own calibration before its readings mean anything.
- **The honest low number was the most valuable output of the week.** 65% ± 3.5 felt
  worse than 89.5%, and it was the first time I actually knew where I stood.
- **Hard gates held the whole time.** Through 49 → 65 → 82 → 94, tool-selection F1 and
  groundedness barely moved (~0.75, ~0.86). The thing that swung wildly — text accuracy
  — was the thing most contaminated by noise and by the budget wall. I should have
  trusted the stable metrics and distrusted the dramatic one.
- **Listen for the offhand operator detail.** The breakthrough wasn't in the eval; it
  was a user aside. The harness narrowed the search ("empty answers after a tool call");
  the human supplied the key.

## What I'd do differently

- Average from run one. Never pin or compare a single-run number again.
- Calibrate the scorer against a handful of hand-graded transcripts before trusting it.
- When a change "regresses" everything, suspect the measurement before the change.
- Measure the request's token budget (prompt + tool schemas + history + reserve) as a
  first-class number, not an afterthought — it was the whole ballgame.

## Open questions

- How much of the 94% is the LoRA going to move? Probably little on the golden set —
  tooling + context already did the work. The LoRA's value is off-distribution and
  prompt-trimming. The eval should keep me honest about that, too.
- The lone flaky item (`multistep-latest-block`) is a tip-drift race in *my ground
  truth*, not the agent. The instrument still has a calibration bug to fix.

## Pointers

- Case study: [`../case_studies/2026-06-09-the-4k-wall.md`](../case_studies/2026-06-09-the-4k-wall.md)
- Essay: [`../essays/2026-06-09-variance-is-the-metric.md`](../essays/2026-06-09-variance-is-the-metric.md)
- Baseline: `scripts/eval/baselines/canonical.json`; harness: `scripts/eval/` + `src/lib/eval/`.
