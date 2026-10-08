#!/usr/bin/env node
// Drive a running app through steps.json and capture, per step, a cursor-less
// viewport plate before and after the action, the target's box, the overlay
// cursor's path and the zoom decision. Writes <out>/manifest.json.
//
//   node capture-steps.mjs --url http://localhost:3000/app --steps steps.json --out captures
//     [--viewport 1440x900] [--scale 2] [--locale es] [--color-scheme light|dark] [--hide sel1,sel2] [--timeout 30000] [--json]
//   A step's optional `waitFor` selector must be visible before its after plate is taken (a streamed page, a toast).
//   node capture-steps.mjs --steps steps.json --dry      (validate only, no browser)
import { join, resolve } from "node:path";
import { parseArgs, fail, list } from "../lib/args.mjs";
import { readJson, writeJson, ensureDir } from "../lib/fs.mjs";
import { launchBrowser, loadSharp } from "../lib/browser.mjs";
import { buildTimeline, estimateSpeechSeconds, nn } from "./narration.mjs";

export const ACTIONS = ["navigate", "click", "hover", "type", "press", "scroll", "wait"];
const REQUIRED = {
  navigate: ["url"],
  click: ["selector"],
  hover: ["selector"],
  type: ["selector", "text"],
  press: ["key"],
  scroll: ["selector"],
  wait: ["selector"],
};
// The overlay cursor travels only for pointer actions; keys, scrolls and waits leave it where it was.
const POINTER_ACTIONS = new Set(["click", "hover", "type"]);
const AUTO_ZOOM_ACTIONS = new Set(["click", "hover", "type", "press"]);

export const ZOOM = { dense: 1.5, small: 2, smallBelow: 120, max: 2.5 };
export const PATH = { samples: 32, bend: 0.12 };
const NARRATION_MAX_WORDS = 12;
const CAPTION_MAX_CHARS = 84;
// ≈1000 device px at 2x: a typed word registers, antialiasing noise does not.
const UI_CHANGE_RATIO = 0.0002;

export const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;cursor:none!important;scroll-behavior:auto!important}" +
  "html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";

export function validateSteps(doc) {
  const errors = [], warnings = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { errors: ["steps file must be a JSON object { title, locale, steps }"], warnings };
  if (doc.title !== undefined && typeof doc.title !== "string") errors.push("title must be a string");
  if (doc.locale !== undefined && typeof doc.locale !== "string") errors.push("locale must be a string");
  if (!Array.isArray(doc.steps) || !doc.steps.length) return { errors: [...errors, "steps must be a non-empty array"], warnings };
  const seen = new Set();
  doc.steps.forEach((s, i) => {
    const tag = `step ${i + 1}${s?.id ? ` "${s.id}"` : ""}${s?.action ? ` (${s.action})` : ""}`;
    if (!s || typeof s !== "object") return void errors.push(`${tag}: must be an object`);
    if (typeof s.id !== "string" || !s.id.trim()) errors.push(`${tag}: missing id`);
    else if (seen.has(s.id)) errors.push(`${tag}: duplicate id`);
    else seen.add(s.id);
    if (!ACTIONS.includes(s.action)) errors.push(`${tag}: action must be one of ${ACTIONS.join(", ")}`);
    for (const field of REQUIRED[s.action] || []) {
      if (typeof s[field] !== "string" || !s[field].length) errors.push(`${tag}: missing ${field}`);
    }
    if (s.selector !== undefined && typeof s.selector !== "string") errors.push(`${tag}: selector must be a string`);
    if (s.waitFor !== undefined && (typeof s.waitFor !== "string" || !s.waitFor.trim())) errors.push(`${tag}: waitFor must be a selector string`);
    for (const field of ["narration", "caption"]) {
      if (typeof s[field] !== "string" || !s[field].trim()) errors.push(`${tag}: missing ${field}`);
    }
    if (s.zoom !== undefined && s.zoom !== "auto" && !(typeof s.zoom === "number" && s.zoom >= 1)) errors.push(`${tag}: zoom must be a number ≥ 1 or "auto"`);
    if (typeof s.zoom === "number" && s.zoom > ZOOM.max) warnings.push(`${tag}: zoom ${s.zoom} capped at ${ZOOM.max}`);
    if (s.holdMs !== undefined && !(typeof s.holdMs === "number" && s.holdMs >= 0)) errors.push(`${tag}: holdMs must be a number ≥ 0`);
    const words = String(s.narration || "").trim().split(/\s+/).filter(Boolean).length;
    if (words > NARRATION_MAX_WORDS) warnings.push(`${tag}: narration has ${words} words (≤ ${NARRATION_MAX_WORDS})`);
    if (String(s.caption || "").length > CAPTION_MAX_CHARS) warnings.push(`${tag}: caption longer than ${CAPTION_MAX_CHARS} chars (2 lines × 42)`);
  });
  return { errors, warnings };
}

const r2 = (n) => Math.round(n * 100) / 100;

export function bboxCentre(bbox) {
  return [r2(bbox.x + bbox.w / 2), r2(bbox.y + bbox.h / 2)];
}

// Cubic Bézier from → to; control points at 1/3 and 2/3 pushed off the chord by
// bend·distance, to the left on even steps and to the right on odd ones.
export function cursorPath(from, to, index = 0, samples = PATH.samples) {
  const [x0, y0] = from, [x3, y3] = to;
  const dx = x3 - x0, dy = y3 - y0;
  const dist = Math.hypot(dx, dy);
  const sign = index % 2 === 0 ? 1 : -1;
  const off = dist * PATH.bend * sign;
  const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
  const c1 = [x0 + dx / 3 + nx * off, y0 + dy / 3 + ny * off];
  const c2 = [x0 + (2 * dx) / 3 + nx * off, y0 + (2 * dy) / 3 + ny * off];
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 1 : i / (samples - 1), u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([r2(a * x0 + b * c1[0] + c * c2[0] + d * x3), r2(a * y0 + b * c1[1] + c * c2[1] + d * y3)]);
  }
  return out;
}

// 1.5× by default, 2× for small controls (larger side < 120 CSS px), never above 2.5×.
export function decideZoom(action, bbox, requested) {
  if (typeof requested === "number") return Math.min(Math.max(requested, 1), ZOOM.max);
  if (!bbox || (requested !== "auto" && !AUTO_ZOOM_ACTIONS.has(action))) return 1;
  return Math.max(bbox.w, bbox.h) < ZOOM.smallBelow ? ZOOM.small : ZOOM.dense;
}

// zoomGroup from a planned timeline that assumes 150 wpm narration; narration.mjs recomputes it from real durations.
export function plannedZoomGroups(manifest) {
  const timeline = buildTimeline(manifest, manifest.steps.map((s) => Math.max(estimateSpeechSeconds(s.narration), 1)));
  return timeline.steps.map((s) => s.zoomGroup);
}

async function settle(page, timeout) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForNetworkIdle({ idleTime: 250, timeout });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => (i.onload = i.onerror = r))));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      return;
    } catch (e) {
      if (!/context was destroyed|navigat|detached/i.test(e.message)) throw new Error(`page did not settle: ${e.message}`);
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout }).catch(() => {});
    }
  }
}

async function freeze(page, hide) {
  const css = FREEZE_CSS + hide.map((s) => `${s}{visibility:hidden!important}`).join("");
  await page.evaluate((text) => {
    if (document.getElementById("__compositor_freeze")) return;
    const style = document.createElement("style");
    style.id = "__compositor_freeze";
    style.textContent = text;
    (document.head || document.documentElement).appendChild(style);
    document.getAnimations?.().forEach((a) => a.finish?.());
  }, css);
}

async function visible(page, selector, timeout) {
  try {
    return await page.waitForSelector(selector, { visible: true, timeout });
  } catch {
    const count = await page.$$eval(selector, (els) => els.length).catch(() => 0);
    throw new Error(count ? `matched ${count} element(s) but none became visible within ${timeout} ms` : `matched nothing within ${timeout} ms`);
  }
}

const box = (el) =>
  el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

async function diffRatio(a, b) {
  const sharp = loadSharp();
  const [ra, rb] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return 1;
  let changed = 0;
  for (let i = 0; i < ra.data.length; i += 3) {
    if (Math.abs(ra.data[i] - rb.data[i]) > 16 || Math.abs(ra.data[i + 1] - rb.data[i + 1]) > 16 || Math.abs(ra.data[i + 2] - rb.data[i + 2]) > 16) changed++;
  }
  return changed / (ra.info.width * ra.info.height);
}

export async function captureSteps({ url, doc, outDir, viewport = [1440, 900], scale = 2, locale, colorScheme, hide = [], timeout = 30_000, log = () => {} }) {
  const [width, height] = viewport;
  const lang = locale || doc.locale || "en";
  ensureDir(outDir);
  const browser = await launchBrowser([`--lang=${lang}`]);
  const timings = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    // Unset, the headless browser inherits the desktop's scheme, so an app that follows it renders whichever the machine prefers.
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }, ...(colorScheme ? [{ name: "prefers-color-scheme", value: colorScheme }] : [])]);
    await page.setExtraHTTPHeaders({ "Accept-Language": lang });
    await page.evaluateOnNewDocument((l) => {
      Object.defineProperty(navigator, "language", { get: () => l });
      Object.defineProperty(navigator, "languages", { get: () => [l] });
    }, lang);
    await page.goto(url, { waitUntil: "networkidle0", timeout });
    await freeze(page, hide);
    await settle(page, timeout);

    let cursor = [width / 2, height / 2];
    const steps = [];
    for (const [index, s] of doc.steps.entries()) {
      const t0 = performance.now();
      const tag = `step ${index + 1} "${s.id}" (${s.action}${s.selector ? ` ${JSON.stringify(s.selector)}` : ""})`;
      const plate = `step-${nn(index)}.png`, afterPlate = `step-${nn(index)}-after.png`;
      const shoot = async (file) => {
        await freeze(page, hide);
        await page.screenshot({ path: join(outDir, file) });
      };
      let bbox = null, typed;
      try {
        await freeze(page, hide);
        if (["click", "hover", "type"].includes(s.action) || (s.action === "press" && s.selector)) {
          const el = await visible(page, s.selector, timeout);
          await settle(page, timeout);
          await el.evaluate((e) => {
            const r = e.getBoundingClientRect();
            if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) e.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          });
          await settle(page, timeout);
          bbox = await box(el);
          await shoot(plate);
          if (s.action === "click") await el.click();
          else if (s.action === "hover") await el.hover();
          else if (s.action === "type") {
            await el.click();
            for (const ch of s.text) await page.keyboard.type(ch);
            typed = { text: s.text, chars: [...s.text].length };
          } else {
            await el.focus();
            await page.keyboard.press(s.key);
          }
        } else {
          await shoot(plate);
          if (s.action === "navigate") await page.goto(new URL(s.url, page.url() || url).href, { waitUntil: "networkidle0", timeout });
          else if (s.action === "press") await page.keyboard.press(s.key);
          else {
            const el = await visible(page, s.selector, timeout);
            if (s.action === "scroll") await el.evaluate((e) => e.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
            await settle(page, timeout);
            bbox = await box(el);
          }
        }
        await settle(page, timeout);
        if (s.waitFor) {
          await visible(page, s.waitFor, timeout);
          await settle(page, timeout);
        }
        await shoot(afterPlate);
      } catch (e) {
        throw new Error(`${tag}: ${e.message}`);
      }

      if (bbox) bbox = { x: r2(bbox.x), y: r2(bbox.y), w: r2(bbox.w), h: r2(bbox.h) };
      const target = bbox && POINTER_ACTIONS.has(s.action) ? bboxCentre(bbox) : cursor;
      const path = cursorPath(cursor, target, index);
      cursor = target;
      const changesUi = s.action === "navigate" || (await diffRatio(join(outDir, plate), join(outDir, afterPlate))) > UI_CHANGE_RATIO;
      steps.push({
        id: s.id,
        index,
        action: s.action,
        selector: s.selector ?? null,
        narration: s.narration,
        caption: s.caption,
        plate,
        afterPlate,
        bbox,
        center: bbox ? bboxCentre(bbox) : target,
        path,
        zoom: decideZoom(s.action, bbox, s.zoom),
        zoomGroup: null,
        ...(typed ? { typed } : {}),
        ...(s.holdMs !== undefined ? { holdMs: s.holdMs } : {}),
        changesUi,
      });
      timings.push({ id: s.id, ms: Math.round(performance.now() - t0) });
      log(`${tag}: ${Math.round(performance.now() - t0)} ms${changesUi ? ", UI changed" : ""}`);
    }

    const manifest = { title: doc.title ?? null, viewport: { width, height }, scale, locale: lang, url, steps };
    plannedZoomGroups(manifest).forEach((g, i) => (steps[i].zoomGroup = g));
    writeJson(join(outDir, "manifest.json"), manifest);
    return { manifest, timings };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.steps || args.steps === true) fail("--steps steps.json is required", 2);
  let doc;
  try {
    doc = readJson(resolve(args.steps));
  } catch (e) {
    fail(`cannot read steps file: ${e.message}`, 2);
  }
  const { errors, warnings } = validateSteps(doc);
  if (args.dry || errors.length) {
    if (args.json) process.stdout.write(JSON.stringify({ ok: !errors.length, steps: doc?.steps?.length ?? 0, errors, warnings }) + "\n");
    else {
      for (const e of errors) process.stderr.write(`error: ${e}\n`);
      for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
      if (!errors.length) process.stdout.write(`steps.json ok: ${doc.steps.length} steps\n`);
    }
    process.exit(errors.length ? 2 : 0);
  }
  if (!args.url || args.url === true) fail("--url is required", 2);
  if (!args.out || args.out === true) fail("--out <dir> is required", 2);
  const viewport = String(args.viewport || "1440x900").split("x").map(Number);
  if (viewport.length !== 2 || viewport.some((n) => !(n > 0))) fail(`--viewport expects WxH, got ${args.viewport}`, 2);
  const colorScheme = args["color-scheme"] && args["color-scheme"] !== true ? args["color-scheme"] : undefined;
  if (colorScheme && !["light", "dark"].includes(colorScheme)) fail(`--color-scheme expects light or dark, got ${colorScheme}`, 2);
  const outDir = resolve(args.out);
  const t0 = performance.now();
  try {
    const { manifest, timings } = await captureSteps({
      url: args.url,
      doc,
      outDir,
      viewport,
      scale: Number(args.scale || 2),
      locale: args.locale && args.locale !== true ? args.locale : undefined,
      colorScheme,
      hide: list(args.hide),
      timeout: Number(args.timeout || 30_000),
      log: args.json ? () => {} : (m) => process.stderr.write(m + "\n"),
    });
    const ms = Math.round(performance.now() - t0);
    if (args.json) process.stdout.write(JSON.stringify({ ok: true, out: outDir, manifest: join(outDir, "manifest.json"), steps: manifest.steps.length, ms, timings, warnings }) + "\n");
    else process.stdout.write(`${manifest.steps.length} steps captured in ${ms} ms → ${join(outDir, "manifest.json")}\n`);
  } catch (e) {
    fail(e.message, 1);
  }
}
