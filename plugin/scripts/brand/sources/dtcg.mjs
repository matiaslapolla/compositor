// DTCG 2025.10 token files → flat name→value lookups (colour only for roles,
// plus fontFamily, duration and cubicBezier for type/motion hints).
import { readFileSync } from "node:fs";
import { walk } from "../../lib/fs.mjs";

export function findTokenFiles(root) {
  return walk(root, (rel, name) => /(^|\/)(tokens?|design-tokens)(\.[\w-]+)?\.json$|\.tokens\.json$/i.test(rel) && !/node_modules/.test(rel), { maxDepth: 5 });
}

function colorValue(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (v.hex) return v.hex;
    const space = v.colorSpace;
    const comps = (v.components || []).map((c) => (c === "none" ? 0 : c));
    if (space === "srgb") return `rgb(${comps.map((c) => Math.round(c * 255)).join(" ")}${v.alpha != null ? ` / ${v.alpha}` : ""})`;
    if (space === "oklch") return `oklch(${comps.join(" ")}${v.alpha != null ? ` / ${v.alpha}` : ""})`;
    if (space === "display-p3") return `color(display-p3 ${comps.join(" ")})`;
    if (space === "hsl") return `hsl(${comps[0]} ${comps[1]}% ${comps[2]}%)`;
    if (space === "oklab") return `oklab(${comps.join(" ")})`;
  }
  return null;
}

export function readDtcg(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const flat = new Map();
  const walkTokens = (node, path, inherited) => {
    if (!node || typeof node !== "object") return;
    const type = node.$type ?? inherited;
    if ("$value" in node) {
      flat.set(path.join("."), { type, value: node.$value, description: node.$description });
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith("$")) walkTokens(v, [...path, k], type);
  };
  walkTokens(data, [], undefined);
  // Resolve {alias} references.
  const resolve = (v, depth = 0) => {
    if (typeof v === "string" && /^\{[^}]+\}$/.test(v) && depth < 6) {
      const hit = flat.get(v.slice(1, -1));
      return hit ? resolve(hit.value, depth + 1) : v;
    }
    return v;
  };
  const light = new Map(), dark = new Map(), fonts = new Map(), motion = new Map();
  for (const [path, tok] of flat) {
    const value = resolve(tok.value);
    const leaf = path.split(".").at(-1).toLowerCase();
    const isDark = /(^|\.)dark(\.|$)/i.test(path);
    const entry = { file, selector: path };
    if (tok.type === "color" || colorValue(value)?.startsWith?.("#")) {
      const cv = colorValue(value);
      if (cv) (isDark ? dark : light).set(leaf, { ...entry, value: cv });
      // Also register the full dotted path minus mode for lookups like "color-accent".
      const dotted = path.replace(/(^|\.)(light|dark)(\.|$)/i, "$1").replace(/\./g, "-").replace(/^-|-$/g, "");
      if (cv && !(isDark ? dark : light).has(dotted)) (isDark ? dark : light).set(dotted, { ...entry, value: cv });
    } else if (tok.type === "fontFamily") {
      fonts.set(leaf, { ...entry, value: Array.isArray(value) ? value[0] : value });
    } else if (tok.type === "duration" || tok.type === "cubicBezier") {
      motion.set(leaf, { ...entry, value, type: tok.type });
    }
  }
  return { light, dark, fonts, motion, file };
}
