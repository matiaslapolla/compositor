# brand.json in one page

`node scripts/brand/resolve.mjs --root <repo> --out compositor/brand.json [--refresh] [--no-fonts]` reads, in order: `frame.md` → `design.md` → `DESIGN.md` (YAML frontmatter or prose role tables), DTCG `tokens*.json`, Tailwind v4 `@theme`, shadcn `:root`/`.dark`, `next/font` + `@font-face`, logo files. The first source with a valid colour for a role wins; disagreements beyond ΔE 0.02 are logged in `conflicts[]`, slop flags in `warnings[]`. Every field has `provenance` (`exact`, `inferred`, `default`, `user`).

Roles: `bg surface fg muted border accent accent-fg success warning error`, light and dark (the missing mode is derived and flagged `inferred`). Each colour carries `oklch` + sRGB `hex`. `color.video.nearBlack` replaces #000 on video. Type: `display`, `body`, `mono` with `stack`, `files` (materialized to `compositor/fonts/`) and `faceCss`. Motion: fps, current direction LEFT, register, video durations, easing roles → GSAP.

`node scripts/brand/theme.mjs --brand compositor/brand.json [--mode dark] --out brand.css` emits the CSS variables build.mjs injects; `--manim theme.json` emits the explain-mode theme.

Ask the user only when: (a) no logo at all or ambiguous candidates; (b) two sources disagree on the accent by ΔE > 0.05 and no DESIGN.md exists; (c) more than two font families with unassignable roles; (d) `color.mode` undeterminable and the canvas matters; (e) `identity.name` absent everywhere. Otherwise proceed with the inferred values and mention them in the report.

Quick audit: `node scripts/brand/resolve.mjs --root . --out /tmp/brand.json --refresh --no-fonts` and read the summary line, conflicts and warnings.
