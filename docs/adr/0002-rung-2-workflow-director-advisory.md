# ADR 0002: rung 2 workflow; the director is advisory

Date: 2026-10-08. Status: accepted.

## Context
The brief proposed an Opus "art director" that gates runs and Haiku verifiers (rung 4, ~15× tokens). No eval shows the fixed workflow failing, and VLM aesthetic judgment is contested (AesEval-Bench 2026).

## Decision
Scripts own the control flow (resolve → plan → author → proof → gate → fix ≤ 3 rounds → deliver → trace). Deterministic gates decide pass/fail. The `director` agent writes the plan and rates proof frames into the trace; it never changes an exit code. `composer` agents run only when a project has ≥ 3 scenes. The `verifier` agent condenses gate JSON only when it exceeds a few KB. After 20 rated runs, pairwise agreement between director ratings and the user's verdicts is measured; ≥ 70% unlocks gating.

## Consequences
Token cost stays near a single skill invocation. Quality beyond the gates depends on templates and defaults, which the traces improve over time.
