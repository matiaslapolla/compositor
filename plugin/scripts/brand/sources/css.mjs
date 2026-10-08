// Custom properties from CSS files, split by scope (light | dark), with
// var() chains resolved inside the scope and provenance per declaration.
import { readFileSync } from "node:fs";
import { walk } from "../../lib/fs.mjs";

const CSS_GLOB = (rel) => /\.css$/.test(rel) && !/\.min\.css$/.test(rel) && !/(^|\/)(dist|out|build|storybook-static)\//.test(rel);

export function findCssFiles(root) {
  const prefer = /(globals?|tokens?|theme|variables|app|index|main|style|brand)\.css$/i;
  const all = walk(root, (rel) => CSS_GLOB(rel), { maxDepth: 7 });
  return all.sort((a, b) => (prefer.test(b) ? 1 : 0) - (prefer.test(a) ? 1 : 0) || a.length - b.length);
}

const DARK_SELECTOR = /(\.dark\b|\[data-theme=["']?dark["']?\]|\.theme-dark|\[data-mode=["']?dark["']?\]|\.dark-theme)/;
const LIGHT_EXCLUDE = /\[data-theme=["']?light["']?\]/;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Recursive block parser: yields { selector, atStack, declarations:[{name,value}] }.
function parseBlocks(css) {
  const out = [];
  let i = 0;
  const stack = [];
  const rec = (parentAt) => {
    let buf = "";
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        const head = buf.trim();
        buf = "";
        i++;
        if (head.startsWith("@") && !/^@theme/.test(head)) {
          stack.push(head);
          rec([...parentAt, head]);
          stack.pop();
        } else {
          const decls = [];
          // Read until the matching brace, collecting declarations and nested blocks.
          let inner = "";
          let depth = 0;
          while (i < css.length) {
            const c = css[i];
            if (c === "{") depth++;
            if (c === "}") {
              if (depth === 0) break;
              depth--;
            }
            inner += c;
            i++;
          }
          i++; // closing brace
          for (const d of splitDeclarations(inner)) decls.push(d);
          out.push({ selector: head, atStack: parentAt, declarations: decls });
        }
      } else if (ch === "}") {
        i++;
        return;
      } else if (ch === ";" && !buf.includes("{")) {
        // `@import …;` / `@custom-variant …;` statements end here; they are not block heads.
        buf = "";
        i++;
      } else {
        buf += ch;
        i++;
      }
    }
  };
  rec([]);
  return out;
}

function splitDeclarations(text) {
  // Drop nested blocks (e.g. `&:hover { }` inside) before splitting on `;`.
  let depth = 0, cur = "", parts = [];
  for (const c of text) {
    if (c === "{") depth++;
    if (c === "}") { depth--; continue; }
    if (depth > 0) continue;
    if (c === ";") { parts.push(cur); cur = ""; } else cur += c;
  }
  parts.push(cur);
  const decls = [];
  for (const p of parts) {
    const m = p.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) decls.push({ name: m[1].slice(2), value: m[2].replace(/\s+/g, " ") });
  }
  return decls;
}

function scopeOf(selector, atStack) {
  const inDarkMedia = atStack.some((a) => /prefers-color-scheme\s*:\s*dark/.test(a));
  if (DARK_SELECTOR.test(selector)) return "dark";
  if (inDarkMedia && !LIGHT_EXCLUDE.test(selector.replace(/:not\([^)]*\)/g, ""))) return "dark";
  if (inDarkMedia) return "dark"; // :root:not([data-theme="light"]) inside the dark media query
  if (/^@theme/.test(selector) || /:root|^html|^body|^\*|^:host/.test(selector)) return "light";
  return null;
}

export function readCssVars(root, { files = findCssFiles(root) } = {}) {
  const vars = { light: new Map(), dark: new Map() };
  const resets = new Set();
  for (const file of files) {
    let css;
    try { css = stripComments(readFileSync(file, "utf8")); } catch { continue; }
    if (!/--[\w-]+\s*:/.test(css)) continue;
    for (const block of parseBlocks(css)) {
      const scope = scopeOf(block.selector, block.atStack);
      if (!scope) continue;
      for (const d of block.declarations) {
        if (d.value === "initial" && d.name.endsWith("-*")) { resets.add(d.name); continue; }
        if (!vars[scope].has(d.name)) vars[scope].set(d.name, { value: d.value, file, selector: block.selector });
      }
    }
  }
  return { vars, files, resets };
}

// Resolves var() chains within a scope (falls back to light). Depth-limited.
export function resolveValue(value, vars, scope, depth = 0) {
  if (depth > 8 || !/var\(/.test(value)) return value;
  const resolved = value.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fallback) => {
    const hit = vars[scope].get(name) || vars.light.get(name);
    if (hit) return resolveValue(hit.value, vars, scope, depth + 1);
    return fallback !== undefined ? fallback.trim() : "";
  });
  return resolved.trim();
}

export function resolvedMap(vars, scope) {
  const out = new Map();
  // A dark scope that declares nothing is no scope at all; light is not re-read as dark.
  if (scope === "dark" && vars.dark.size === 0) return out;
  const names = new Set([...vars.light.keys(), ...vars[scope].keys()]);
  for (const name of names) {
    const hit = vars[scope].get(name) || vars.light.get(name);
    out.set(name, { ...hit, raw: hit.value, value: resolveValue(hit.value, vars, scope), scoped: vars[scope].has(name) });
  }
  return out;
}
