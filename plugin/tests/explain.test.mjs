import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTheme } from "../scripts/explain/theme-from-brand.mjs";
import { run, mapLint, mapBounds, dominantColor, checkBackground } from "../scripts/gates/explain-lint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (...p) => join(here, "fixtures", "explain", ...p);
const runSh = join(here, "..", "scripts", "explain", "run.sh");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

const THEME_KEYS = ["BG", "INK", "MUTED", "GRID", "DATA", "MODEL", "ERROR", "SIGNAL", "FOCUS", "FONT", "MONO", "fontFiles"];

test("theme-from-brand: manimTheme shape, near-black BG on dark, fonts copied with a fonts.conf", () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-theme-"));
  const { theme, missing } = buildTheme(fx("brand.json"), join(dir, "theme.json"));
  const written = json(join(dir, "theme.json"));
  assert.deepEqual(Object.keys(written).sort(), [...THEME_KEYS].sort());
  assert.equal(written.BG, "#16181c");
  assert.equal(written.DATA, "#5f92ea");
  assert.equal(written.FONT, "Fixture Sans");
  assert.equal(written.MONO, "Fixture Mono");
  assert.deepEqual(readdirSync(join(dir, "fonts")), ["Fixture-400.ttf"]);
  assert.deepEqual(theme.fontFiles, [join(dir, "fonts", "Fixture-400.ttf")]);
  assert.deepEqual(missing, ["fonts/Missing-700.ttf"]);
  const conf = readFileSync(join(dir, "fonts.conf"), "utf8");
  assert.match(conf, /<include ignore_missing="yes">\/etc\/fonts\/fonts\.conf<\/include>/);
  assert.ok(conf.includes(`<dir>${join(dir, "fonts")}</dir>`));
});

test("theme-from-brand: --mode light switches roles and reads the light roles", () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-theme-"));
  const { theme } = buildTheme(fx("brand.json"), join(dir, "theme.json"), { mode: "light", fontRoots: ["/nonexistent"] });
  assert.equal(theme.BG, "#f7f7f5");
  assert.equal(theme.INK, "#1c1a19");
});

test("theme-from-brand CLI: missing flags exit 2", () => {
  const r = spawnSync("node", [join(here, "..", "scripts", "explain", "theme-from-brand.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("explain-lint maps lint levels and bounds issues to gate statuses", () => {
  const lint = mapLint(json(fx("lint.json")));
  assert.deepEqual(lint.map((f) => [f.rule, f.status]), [["explain.narration", "fail"], ["explain.narration", "warn"]]);
  assert.match(lint[0].evidence, /episode\.py:12: 26 words/);
  const bounds = mapBounds(json(fx("bounds.json")));
  assert.deepEqual(bounds.map((f) => [f.rule, f.status]), [["explain.bounds", "fail"], ["explain.bounds", "warn"]]);
  assert.equal(mapBounds([]).at(0).status, "pass");
  assert.equal(mapBounds(json(fx("bounds.json")).findings).length, 2);
});

test("explain-lint run: fixture lint output + bounds.json fail the gate; missing video is skipped", async () => {
  const result = await run(
    { runDir: fx("run"), stage: "proof", plan: json(fx("run", "plan.json")) },
    { lint: () => ({ rows: json(fx("lint.json")) }) },
  );
  assert.equal(result.gate, "explain-lint");
  assert.equal(result.status, "fail");
  const byRule = (r) => result.findings.filter((f) => f.rule === r).map((f) => f.status);
  assert.deepEqual(byRule("explain.narration"), ["fail", "warn"]);
  assert.deepEqual(byRule("explain.bounds"), ["fail", "warn"]);
  assert.deepEqual(byRule("explain.theme-bg"), ["skip"]);
});

test("explain-lint run: clean lint with no bounds and no video skips the unmeasurable parts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-gate-"));
  const result = await run({ runDir: dir, plan: { explain: {} } });
  assert.equal(result.status, "skip");
  assert.deepEqual(result.findings.map((f) => f.status), ["skip", "skip", "skip"]);
  const clean = await run({ runDir: fx("run"), plan: json(fx("run", "plan.json")) }, { lint: () => ({ rows: [] }) });
  assert.equal(clean.findings[0].status, "pass");
  const lintSkipped = await run({ runDir: fx("run"), plan: json(fx("run", "plan.json")) }, { lint: () => ({ skip: "no env" }) });
  assert.equal(lintSkipped.findings[0].status, "skip");
});

test("theme-bg: dominant colour ignores foreground pixels; ΔE decides pass or fail", () => {
  const px = (r, g, b, n) => Array(n).fill([r, g, b]).flat();
  assert.equal(dominantColor(Uint8Array.from([...px(22, 24, 28, 90), ...px(236, 235, 232, 10)])), "#16181c");
  const same = checkBackground("x.mp4", "#16181c", { duration: 10, sample: () => "#15161b" });
  assert.equal(same.status, "pass");
  const other = checkBackground("x.mp4", "#16181c", { duration: 10, sample: () => "#000000" });
  assert.equal(other.status, "fail");
  assert.equal(checkBackground("x.mp4", "#16181c", { duration: 10, sample: () => null }).status, "skip");
});

test("run.sh: valid bash, --help lists every command, bad usage exits 2", () => {
  assert.equal(spawnSync("bash", ["-n", runSh]).status, 0);
  const help = spawnSync("bash", [runSh, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  for (const cmd of ["setup", "doctor", "lint", "preview", "render", "frames", "say", "--theme", "--home"]) assert.ok(help.stdout.includes(cmd), cmd);
  assert.equal(spawnSync("bash", [runSh, "bogus"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync("bash", [runSh], { encoding: "utf8" }).status, 2);
  const noTheme = spawnSync("bash", [runSh, "lint", "x.py", "--theme", "/nonexistent.json"], { encoding: "utf8" });
  assert.equal(noTheme.status, 2);
  assert.match(noTheme.stderr, /theme not found/);
  const badQuality = spawnSync("bash", [runSh, "render", "x.py", "--quality", "m"], { encoding: "utf8" });
  assert.equal(badQuality.status, 2);
});

test("run.sh doctor without an env exits 1 and says what to run", () => {
  const r = spawnSync("bash", [runSh, "doctor"], { encoding: "utf8", env: { ...process.env, COMPOSITOR_DATA: mkdtempSync(join(tmpdir(), "explain-data-")) } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run: .*run\.sh setup/);
});
