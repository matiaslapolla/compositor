# compositor

Media-generation harness for Claude Code: brand tokens in, social assets, ads, promo videos, math explainers, in-app guides and logo packages out, rendered locally and gated deterministically.

- Plugin: [`plugin/`](plugin/README.md) (install from this repo as a local marketplace).
- Spec: `docs/specs/compositor.md`. Decisions: `docs/adr/`. Research: `docs/research/`.
- License: MIT (`LICENSE`); third-party notes in `THIRD_PARTY_NOTICES.md`.

## Install

```sh
claude plugin marketplace add matiaslapolla/compositor
claude plugin install compositor@compositor-local
```

Setup details and the doctor script: [`plugin/README.md`](plugin/README.md).
