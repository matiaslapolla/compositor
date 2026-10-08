// Brand sheet (1600×2000) and OG card (1200×630) as self-contained HTML, rendered
// with local Chromium. Every asset is inline (SVG or data URI): no network.
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { launchBrowser } from "../lib/browser.mjs";
import { normalizeColor } from "../lib/color.mjs";
import { readSvgPaths, monoVariant } from "./compose.mjs";
import { measure } from "./generators/boolean.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dataUri = (buf, mime) => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
const FONT_MIME = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" };

function fontFace(fontFile) {
  if (!fontFile || !existsSync(fontFile)) return "";
  const mime = FONT_MIME[extname(fontFile).toLowerCase()];
  return mime ? `@font-face{font-family:"Brand";src:url(${dataUri(readFileSync(fontFile), mime)});font-display:block}` : "";
}

// Inline SVG re-sized to a box; viewBox keeps proportions.
const inline = (svg, style = "") => svg.replace(/<svg\b([^>]*)>/, (_, a) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, "")} style="${style}">`);

const oklchText = (hex) => {
  const c = normalizeColor(hex);
  return c ? `oklch(${(c.oklch[0] * 100).toFixed(1)}% ${c.oklch[1].toFixed(3)} ${c.oklch[2].toFixed(1)})` : "";
};

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--w);height:var(--h);overflow:hidden}
body{background:var(--bg);color:var(--fg);font:400 15px/1.4 "Brand",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.label{font:500 11px/1 ui-monospace,"JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
`;

// data: { name, tagline, markSvg, constructionSvg, lockupSvg, monoBlackSvg, monoWhiteSvg,
//   roles: {light, dark}, chips: [{name, hex}], minSizes: [{px, png}], clearSpace, fontFile }
export function sheetHtml(d) {
  const L = d.roles.light, D = d.roles.dark;
  const m = measure(readSvgPaths(d.markSvg).map((a) => ({ d: a.d, fill: a.fill, fillRule: a["fill-rule"] })).filter((e) => e.fill !== "none"));
  const b = m.bbox, cs = (d.clearSpace ?? 1) * b.height;
  const vb = [b.minX - cs * 1.35, b.minY - cs * 1.35, b.width + cs * 2.7, b.height + cs * 2.7];
  const clear = d.markSvg
    .replace(/viewBox="[^"]*"/, `viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}"`)
    .replace(/<\/svg>\s*$/, `<g fill="none" stroke="${L.accent}" stroke-width="${(vb[2] / 400).toFixed(2)}">
      <rect x="${b.minX - cs}" y="${b.minY - cs}" width="${b.width + 2 * cs}" height="${b.height + 2 * cs}" stroke-dasharray="${(vb[2] / 120).toFixed(1)}"/>
      <rect x="${b.minX}" y="${b.minY}" width="${b.width}" height="${b.height}" opacity=".5"/>
    </g>
    <g fill="${L.accent}" font-family="ui-monospace,monospace" font-size="${(vb[2] / 34).toFixed(1)}" text-anchor="middle">
      <text x="${b.minX + b.width / 2}" y="${b.minY - cs / 2 + vb[2] / 90}">x</text>
      <text x="${b.minX - cs / 2}" y="${b.minY + b.height / 2 + vb[2] / 90}">x</text>
    </g></svg>`);
  const dont = (inner, caption) => `<figure class="dont"><div class="tile">${inner}</div><figcaption><span>✕</span>${esc(caption)}</figcaption></figure>`;
  const markIn = (svg, style) => inline(svg, `width:100%;height:100%;${style}`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace(d.fontFile)}
:root{--w:1600px;--h:2000px;--bg:${L.bg};--fg:${L.fg};--muted:${L.muted};--surface:${L.surface};--border:${L.border};--accent:${L.accent};--dbg:${D.bg}}
${BASE_CSS}
.page{position:relative;width:1600px;height:2000px;padding:64px 72px;display:grid;grid-template-rows:auto 560px 470px 150px 190px 1fr;gap:28px}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--border);padding-bottom:20px}
header h1{font:600 28px/1 "Brand",ui-sans-serif,system-ui;letter-spacing:-.01em}
.panel{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden}
.panel > .label{position:absolute;left:20px;top:18px}
.hero{display:flex;align-items:center;justify-content:center}
.hero svg{width:900px;height:380px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.two .panel{display:flex;align-items:center;justify-content:center}
.two svg{width:400px;height:400px}
.min{display:flex;gap:28px}
.min .panel{flex:1;display:flex;align-items:flex-end;gap:44px;padding:0 32px 26px}
.min .dark{background:var(--dbg);border-color:var(--dbg)}
.min figure{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.min img{image-rendering:pixelated;display:block}
.chips{display:grid;grid-template-columns:repeat(${Math.max(3, d.chips.length)},1fr);gap:16px}
.chip{border:1px solid var(--border);border-radius:4px;overflow:hidden;display:flex;flex-direction:column}
.chip .sw{flex:1;min-height:96px}
.chip .meta{padding:12px 14px;display:flex;flex-direction:column;gap:6px;background:var(--bg)}
.chip b{font:600 13px/1 "Brand",ui-sans-serif,system-ui}
.chip code{font:400 12px/1 ui-monospace,monospace;color:var(--muted)}
.bottom{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-content:start}
.row{display:grid;grid-template-columns:repeat(3,220px);justify-content:space-between;row-gap:14px;align-content:start}
.row .tile{width:220px;height:220px;border-radius:4px;display:flex;align-items:center;justify-content:center;padding:30px;border:1px solid var(--border);overflow:hidden}
.row h3{grid-column:1/-1}
.dont figcaption{margin-top:10px;font:500 12px/1.2 ui-monospace,monospace;color:var(--fg);display:flex;gap:8px}
.dont figcaption span{color:#d93025;font-weight:700}
.dont .tile{position:relative}
.dont .tile::after{content:"";position:absolute;inset:10px;border:2px solid #d93025;border-radius:3px;opacity:.7}
</style></head><body><div class="page">
<header><h1>${esc(d.name)}</h1><span class="label">Mark system · ${esc(d.generator ?? "")}${d.tagline ? " · " + esc(d.tagline) : ""}</span></header>
<section class="panel hero"><span class="label">Primary lockup</span>${inline(d.lockupSvg, "width:900px;height:380px")}</section>
<section class="two">
  <div class="panel"><span class="label">Construction · unit grid 1/${d.divisions ?? 24}</span>${inline(d.constructionSvg, "width:420px;height:420px")}</div>
  <div class="panel"><span class="label">Clear space · x = ${(d.clearSpace ?? 1).toFixed(2)} × mark height</span>${inline(clear, "width:420px;height:420px")}</div>
</section>
<section class="min">
  <div class="panel"><span class="label">Minimum sizes · real pixels</span>${d.minSizes.map((s) => `<figure><img src="${s.png}" width="${s.px}" height="${s.px}" alt=""><span class="label">${s.px}px</span></figure>`).join("")}</div>
  <div class="panel dark"><span class="label" style="color:${D.muted}">Reverse</span>${(d.minSizesDark ?? d.minSizes).map((s) => `<figure><img src="${s.png}" width="${s.px}" height="${s.px}" alt=""><span class="label" style="color:${D.muted}">${s.px}px</span></figure>`).join("")}</div>
</section>
<section class="chips">${d.chips.map((c) => `<div class="chip"><div class="sw" style="background:${c.hex}"></div><div class="meta"><b>${esc(c.name)}</b><code>${c.hex}</code><code>${oklchText(c.hex)}</code></div></div>`).join("")}</section>
<section class="bottom">
  <div class="row"><h3 class="label">Colour · one colour · reverse</h3>
    <div class="tile" style="background:${L.bg}">${markIn(d.markSvg)}</div>
    <div class="tile" style="background:#ffffff">${markIn(d.monoBlackSvg)}</div>
    <div class="tile" style="background:#0a0a0a;border-color:#0a0a0a">${markIn(d.monoWhiteSvg)}</div>
  </div>
  <div class="row"><h3 class="label">Don't</h3>
    ${dont(markIn(d.markSvg, "transform:scaleX(1.45)"), "Stretch or squash")}
    ${dont(markIn(monoVariant(d.markSvg, L.border)), "Set on low contrast")}
    ${dont(markIn(d.markSvg, `filter:drop-shadow(0 14px 18px rgba(0,0,0,.45)) saturate(2) hue-rotate(40deg)`), "Add effects or recolour")}
  </div>
</section>
</div></body></html>`;
}

// OG card: lockup left with ≥ 60 px margins, optional tagline under it.
export function ogHtml({ lockupSvg, roles, tagline, fontFile }) {
  const L = roles.light;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace(fontFile)}
:root{--w:1200px;--h:630px;--bg:${L.bg};--fg:${L.fg};--muted:${L.muted}}
${BASE_CSS}
.og{width:1200px;height:630px;padding:0 96px;display:flex;flex-direction:column;justify-content:center;gap:36px}
.og svg{width:auto;height:200px;max-width:900px;align-self:flex-start}
.og p{font:400 34px/1.25 "Brand",ui-sans-serif,system-ui;color:var(--muted);max-width:820px;letter-spacing:-.005em}
</style></head><body><div class="og">${inline(lockupSvg, "height:200px;width:auto;max-width:900px")}${tagline ? `<p>${esc(tagline)}</p>` : ""}</div></body></html>`;
}

// Renders each { html, out, width, height } with one browser.
export async function renderHtml(jobs) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const j of jobs) {
      await page.setViewport({ width: j.width, height: j.height, deviceScaleFactor: 1 });
      await page.setContent(j.html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: j.out, type: "png", clip: { x: 0, y: 0, width: j.width, height: j.height } });
    }
  } finally {
    await browser.close();
  }
}

export { dataUri };
