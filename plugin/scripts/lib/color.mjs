import { converter, formatHex, parse, clampChroma, wcagContrast, differenceEuclidean, inGamut } from "culori";

const toOklch = converter("oklch");
const toRgb = converter("rgb");
const srgb = inGamut("rgb");

// Any CSS colour string → { oklch:[L,C,H], hex } gamut-mapped to sRGB.
// Chroma is reduced at constant L and H until the colour fits (CSS Color 4 style).
export function normalizeColor(input) {
  const parsed = typeof input === "string" ? parse(input.trim()) : input;
  if (!parsed) return null;
  const ok = toOklch(parsed);
  const mapped = srgb(ok) ? ok : clampChroma(ok, "oklch", "rgb");
  const hex = formatHex(toRgb(mapped));
  return {
    oklch: [round(ok.l, 4), round(ok.c, 4), Number.isFinite(ok.h) ? round(ok.h, 2) : 0],
    hex,
    alpha: parsed.alpha !== undefined && parsed.alpha !== 1 ? parsed.alpha : undefined,
    clamped: !srgb(ok),
  };
}

export function hexOf(input) {
  return normalizeColor(input)?.hex ?? null;
}

export const contrast = (a, b) => round(wcagContrast(a, b), 2);

// Perceptual distance in OKLab (ΔE_OK). 0.02 ≈ just noticeable.
const dE = differenceEuclidean("oklab");
export const deltaE = (a, b) => round(dE(a, b), 4);

export function fromOklch([l, c, h], alpha) {
  return normalizeColor({ mode: "oklch", l, c, h, alpha });
}

// Lighter/darker sibling at constant hue: raise L, lower C (dark-mode accents).
export function shift(input, { dl = 0, dc = 0, dh = 0 } = {}) {
  const ok = toOklch(typeof input === "string" ? parse(input) : input);
  return fromOklch([clamp01(ok.l + dl), Math.max(0, ok.c + dc), ((ok.h || 0) + dh + 360) % 360]);
}

export function luminance(hex) {
  const { r, g, b } = toRgb(parse(hex));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Picks the role colour with the best contrast against `bg`.
export function pickForeground(bg, candidates) {
  return candidates.map((c) => [c, wcagContrast(c, bg)]).sort((a, b) => b[1] - a[1])[0][0];
}

// All hex colours literally present in a text (CSS/HTML), lowercase, 6-digit.
export function hexesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    const h = m[1].toLowerCase();
    if (h.length === 3) out.add("#" + [...h].map((c) => c + c).join(""));
    else if (h.length === 6) out.add("#" + h);
    else if (h.length === 8) out.add("#" + h.slice(0, 6));
  }
  for (const m of text.matchAll(/\b(oklch|rgb|hsl|lab|lch|oklab)\([^)]*\)/gi)) {
    const hex = hexOf(m[0]);
    if (hex) out.add(hex);
  }
  return [...out];
}

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v, d) => Number(v.toFixed(d));
