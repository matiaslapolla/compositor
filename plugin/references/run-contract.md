# Run contract

Every mode follows the same path. Scripts own the order; the model authors inside the steps.

```
compositor/                       # inside the product repo
  brand.json                      # resolved once, --refresh to rebuild
  fonts/                          # materialized woff2
  runs/<slug>/
    brief.md  plan.json  params.json  plan.md
    project/<target>/index.html   # one HyperFrames project per target (+ _shared/{fonts,assets})
    proof/<target>/*.png  proof/sheet.png
    gates.json  findings.md  run.json
    dist/<target>/<target>.mp4|png  dist/README.md
```

Steps (P = plugin root, R = run dir, B = `compositor/brand.json`):

1. `node P/scripts/doctor.mjs --quiet` (stops on a missing requirement).
2. `node P/scripts/brand/resolve.mjs --root . --out B` when B is missing (or `--refresh`). Read the summary: conflicts and warnings go to the user only in the five ask-cases (`references/brand.md`).
3. `mkdir -p R && node P/scripts/trace/run.mjs init --run R --mode <mode> --brief "<brief>" --brand B [--eval <row>]` then `node P/scripts/trace/run.mjs usage --run R --mark start`.
4. Plan: the mode skill decides the template(s), targets and params. For ad, promo, guide and any brief with ≥ 3 scenes, delegate the plan to the `compositor:director` agent (it writes `R/plan.md` and the params draft). Confirm the plan with the user once (AskUserQuestion: confirm, or change targets/copy/duration) unless the brief says `--yes`.
5. Build: `node P/scripts/render/build.mjs --run R --template <mode/name> --params R/params.json --brand B --targets a,b [--mode light|dark] [--assets …]`.
6. Proof: `node P/scripts/render/proof.mjs --run R` → look at `R/proof/sheet.png` (Read it as an image). Optional: the director reviews it (`findings.md`, advisory).
7. Gate: `node P/scripts/gates/gate.mjs --run R --stage proof --brand B --mode <mode>`. On fail: fix params or the template copy, rebuild, re-proof; at most one round per gate class, three rounds total; then stop and report what remains.
8. Deliver: `node P/scripts/render/deliver.mjs --run R` then `node P/scripts/gates/gate.mjs --run R --stage dist --brand B --mode <mode>`.
9. Trace: `node P/scripts/trace/run.mjs record --run R --key gates.dist --file R/gates.json`, `usage --mark end`, `record --key plan --file R/plan.json`. If the director ran: `record --key director --value '<json block from findings.md>'`.
10. Report to the user: the `dist/README.md` table, the proof sheet path, the gate table, the one change that would raise quality most, and `node P/scripts/trace/run.mjs verdict --run R publish|reject` as the next step.

Rules: never call a HyperFrames command that needs a key (`capture` without `--skip-vision`, `snapshot` without `--describe false`, `media-use` without `--local-only`, `publish`, `cloud`). Never push to a platform. Never edit `brand.json` by hand; fix the source (DESIGN.md, CSS) and `--refresh`.
