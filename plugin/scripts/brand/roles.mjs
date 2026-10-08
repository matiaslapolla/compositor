// Role assignment from variable names, checked against colour relationships so
// a shadcn `--muted` (a surface) is not mistaken for muted text.
import { normalizeColor, contrast, deltaE } from "../lib/color.mjs";

export const ROLE_CANDIDATES = {
  bg: ["color-bg", "bg", "background", "color-background", "color-canvas", "canvas", "page", "color-page", "paper", "ground", "surface-0", "base"],
  surface: ["color-surface", "surface", "card", "color-card", "panel", "color-panel", "popover", "surface-1", "elevated", "sunken"],
  fg: ["color-fg", "fg", "foreground", "color-foreground", "color-ink", "ink", "text", "color-text", "body", "on-background", "on-surface"],
  muted: ["muted-foreground", "color-muted-foreground", "muted-fg", "text-muted", "color-text-muted", "color-muted", "secondary-foreground", "muted", "subtle"],
  border: ["color-border", "border", "line", "color-line", "rule", "hairline", "divider", "outline", "input", "stroke"],
  accent: ["color-accent", "brand", "color-brand", "primary", "color-primary", "accent", "highlight", "color-highlight", "suite", "interactive"],
  "accent-fg": ["color-accent-fg", "accent-fg", "primary-foreground", "on-accent", "on-primary", "accent-foreground", "color-primary-foreground", "highlight-foreground"],
  success: ["color-success", "success", "ok", "positive", "signal-green", "green"],
  warning: ["color-warning", "warning", "warn", "amber", "caution", "signal-amber"],
  error: ["color-error", "error", "destructive", "danger", "color-danger", "negative", "danger-red", "red"],
};


function colorOf(entry) {
  if (!entry) return null;
  const c = normalizeColor(entry.value);
  return c ? { ...c, entry } : null;
}

// Validity checks per role against what is already assigned.
const CHECKS = {
  bg: () => true,
  fg: (c, a) => !a.bg || contrast(c.hex, a.bg.hex) >= 4.5,
  surface: (c, a) => !a.bg || (deltaE(c.hex, a.bg.hex) < 0.2 && (!a.fg || deltaE(c.hex, a.fg.hex) > 0.3)),
  muted: (c, a) => !a.bg || (contrast(c.hex, a.bg.hex) >= 3 && (!a.fg || deltaE(c.hex, a.fg.hex) > 0.03)),
  border: (c, a) => !a.bg || (contrast(c.hex, a.bg.hex) >= 1.08 && contrast(c.hex, a.bg.hex) <= 5),
  accent: (c, a) => c.oklch[1] >= 0.04 && (!a.bg || deltaE(c.hex, a.bg.hex) > 0.08),
  "accent-fg": (c, a) => !a.accent || contrast(c.hex, a.accent.hex) >= 3,
  success: (c) => c.oklch[1] >= 0.03,
  warning: (c) => c.oklch[1] >= 0.03,
  error: (c) => c.oklch[1] >= 0.03,
};

// `lookup(name)` returns { value, file, selector } or undefined.
const ACHROMATIC_OK = new Set(["color-accent", "accent", "brand", "color-brand", "highlight", "color-highlight"]);

export function assignRoles(lookup, { names = [] } = {}) {
  const assigned = {};
  const provenance = {};
  const order = ["bg", "fg", "surface", "muted", "border", "accent", "accent-fg", "success", "warning", "error"];
  // shadcn signature: `--primary` is the brand action colour and `--accent` a hover tint.
  const shadcn = Boolean(lookup("primary-foreground") || lookup("color-primary-foreground"));
  for (const role of order) {
    let candidates = [...ROLE_CANDIDATES[role]];
    if (role === "accent" && shadcn) candidates = candidates.filter((c) => !/^(color-)?accent$/.test(c));
    // Substring fallback: any known name containing a candidate keyword.
    for (const key of ROLE_CANDIDATES[role]) {
      for (const n of names) if (n !== key && n.endsWith(`-${key}`) && !candidates.includes(n)) candidates.push(n);
    }
    for (const key of candidates) {
      const c = colorOf(lookup(key));
      if (!c || !CHECKS[role](c, assigned)) continue;
      assigned[role] = c;
      provenance[role] = { name: key, ...c.entry };
      break;
    }
    // A deliberately quiet brand may name an achromatic accent; accept it over inventing one.
    if (role === "accent" && !assigned.accent) {
      for (const key of candidates.filter((k) => ACHROMATIC_OK.has(k))) {
        const c = colorOf(lookup(key));
        if (!c || (assigned.bg && deltaE(c.hex, assigned.bg.hex) < 0.08)) continue;
        assigned.accent = c;
        provenance.accent = { name: key, ...c.entry, achromatic: true };
        break;
      }
    }
  }
  return { assigned, provenance };
}
