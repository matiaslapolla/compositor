// Tutorial rules (docs/research/ads-and-tutorials.md, tutorial rules 5, 7, 8, 10) on plan.steps.
import { finding, result, skip, captionLines, words, cli, isMain } from "./common.mjs";

const GATE = "guide-lint";
export const IMPERATIVES = new Set([
  "click", "open", "select", "type", "press", "go", "choose", "tap", "drag", "scroll", "enter", "save",
  "hover", "check", "copy", "paste", "add", "fill", "upload", "pick", "switch", "toggle", "create", "find",
  "hacé", "abrí", "elegí", "escribí", "tocá", "clic", "presioná", "seleccioná", "andá", "guardá",
  "arrastrá", "ingresá", "completá", "buscá", "agregá", "creá", "copiá", "pegá", "subí",
]);

export const sentences = (text) => String(text ?? "").split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
const firstWord = (s) => (s.match(/[\p{L}']+/u)?.[0] ?? "").toLowerCase();

export function isCaptionOnly(plan = {}) {
  return Boolean(plan.captionOnly || plan.guide?.captionOnly || plan.variant === "caption-only" || !plan.audio?.vo);
}

export function lintSteps(steps = [], { captionOnly = false } = {}) {
  const out = [];
  const list = [...steps].sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.index ?? 0) - (b.index ?? 0));
  const end = (s, i) => (s.start ?? 0) + (s.duration ?? ((list[i + 1]?.start ?? s.start ?? 0) - (s.start ?? 0)));

  list.forEach((s, i) => {
    const step = s.index ?? i + 1;
    const d = end(s, i) - (s.start ?? 0);
    if (s.duration != null || list[i + 1]) {
      out.push(finding("guide.pace", d < 1 ? "fail" : d < 2 || d > 4 ? "warn" : "pass", { step, measured: Number(d.toFixed(3)), expected: "2–4 s per action (fail < 1 s)" }));
    }

    const next = list[i + 1];
    if (next) {
      const gap = (next.actionAt ?? next.start ?? 0) - (s.actionAt ?? s.start ?? 0);
      if (gap < 0.5) out.push(finding("guide.gap", "fail", { step, measured: Number(gap.toFixed(3)), expected: ">= 0.5 s between actions" }));
    }

    if (s.zoom != null && s.zoom > 2) out.push(finding("guide.zoom", s.zoom > 2.5 ? "fail" : "warn", { step, measured: s.zoom, expected: "<= 2 (fail > 2.5)" }));

    if (s.caption) {
      const lines = captionLines(s.caption);
      const long = lines.filter((l) => l.length > 42);
      if (long.length) out.push(finding("guide.caption-line", "fail", { step, measured: long.map((l) => l.length), expected: "<= 42 chars per line", caption: s.caption }));
      if (lines.length > 2) out.push(finding("guide.caption-lines", "fail", { step, measured: lines.length, expected: "<= 2 lines", caption: s.caption }));
      if (captionOnly) {
        const hold = s.captionDuration ?? d;
        const min = Math.max(1.2, s.caption.replace(/\s+/g, " ").trim().length / 15);
        if (hold < min) out.push(finding("guide.caption-hold", "fail", { step, measured: Number(hold.toFixed(3)), expected: `>= ${min.toFixed(2)} s (max(1.2, chars/15))` }));
      }
    }

    const said = sentences(s.narration);
    for (const sentence of said) {
      const n = words(sentence).length;
      if (n > 12) out.push(finding("guide.narration-words", "warn", { step, measured: n, expected: "<= 12 words per sentence", sentence }));
    }
    if (said.length && !IMPERATIVES.has(firstWord(said[0]))) {
      out.push(finding("guide.verb-first", "warn", { step, measured: firstWord(said[0]), expected: "imperative verb first", sentence: said[0] }));
    }
  });

  const chapters = new Map();
  list.forEach((s, i) => {
    if (s.chapter == null) return;
    const c = chapters.get(s.chapter) ?? { start: Infinity, end: -Infinity };
    c.start = Math.min(c.start, s.start ?? 0);
    c.end = Math.max(c.end, end(s, i));
    chapters.set(s.chapter, c);
  });
  for (const [chapter, c] of chapters) {
    if (c.end - c.start > 40) out.push(finding("guide.chapter", "warn", { chapter, measured: Number((c.end - c.start).toFixed(3)), expected: "<= 40 s" }));
  }

  const total = list.length ? Math.max(...list.map((s, i) => end(s, i))) : 0;
  if (total > 120) out.push(finding("guide.total", "warn", { measured: Number(total.toFixed(3)), expected: "<= 120 s" }));
  return out;
}

export async function run(ctx) {
  const mode = ctx.mode ?? ctx.plan?.mode;
  if (mode !== "guide") return skip(GATE, `mode ${mode ?? "unknown"} is not guide`);
  const steps = ctx.plan?.steps ?? [];
  if (!steps.length) return result(GATE, [finding("guide.steps", "fail", { reason: "plan.steps is empty" })]);
  return result(GATE, lintSteps(steps, { captionOnly: isCaptionOnly(ctx.plan) }));
}

if (isMain(import.meta.url)) await cli(run);
