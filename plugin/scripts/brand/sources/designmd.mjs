// DESIGN.md: YAML frontmatter (the @google/design.md shape), markdown role
// tables (role | light | dark) and a few prose fields.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { normalizeColor } from "../../lib/color.mjs";

export function findDesignMd(root) {
  for (const rel of ["frame.md", "design.md", "DESIGN.md", "docs/DESIGN.md", "docs/design.md"]) {
    const p = join(root, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

export function readDesignMd(path) {
  const text = readFileSync(path, "utf8");
  const fm = frontmatter(text);
  const body = fm ? text.slice(fm.end) : text;
  return { path, frontmatter: fm?.data ?? null, tables: roleTables(body), prose: prose(body, fm?.data) };
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  try {
    return { data: YAML.parse(m[1]), end: m[0].length };
  } catch {
    return null;
  }
}

// Resolves "{colors.indigo-blue}" aliases inside the frontmatter.
export function resolveAlias(value, data, depth = 0) {
  if (typeof value !== "string" || depth > 5) return value;
  const m = value.match(/^\{([\w.-]+)\}$/);
  if (!m) return value;
  const hit = m[1].split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), data);
  return hit === undefined ? value : resolveAlias(hit, data, depth + 1);
}

function parseCell(cell) {
  const c = cell.trim();
  if (!c || /the product's|—|^-$|n\/a/i.test(c)) return null;
  if (/^(oklch|rgb|hsl|lab|lch|oklab)\(|^#/.test(c)) return normalizeColor(c);
  const triplet = c.match(/^(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)$/);
  if (triplet) return normalizeColor(`oklch(${triplet[1]} ${triplet[2]} ${triplet[3]})`);
  return null;
}

// Tables whose header starts with "role" and has light (and maybe dark) columns.
function roleTables(body) {
  const lines = body.split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!/^\|\s*role\s*\|/i.test(header)) continue;
    const cols = header.split("|").slice(1, -1).map((s) => s.trim().toLowerCase());
    const li = cols.findIndex((c) => /^light|^value|^hex|^colou?r/.test(c));
    const di = cols.findIndex((c) => /^dark/.test(c));
    for (let j = i + 2; j < lines.length && /^\|/.test(lines[j]); j++) {
      const cells = lines[j].split("|").slice(1, -1).map((s) => s.trim());
      const roleCell = cells[0] || "";
      const roleNames = roleCell.split("/").map((r) => r.replace(/\(.*?\)/g, "").trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
      const lightCells = li >= 0 ? (cells[li] || "").split("/") : [];
      const darkCells = di >= 0 ? (cells[di] || "").split("/") : [];
      roleNames.forEach((name, k) => {
        const light = parseCell(lightCells[k] ?? lightCells[0] ?? "");
        const dark = parseCell(darkCells[k] ?? darkCells[0] ?? "");
        if (light || dark) rows.push({ name, light, dark, line: j + 1 });
      });
    }
  }
  return rows;
}

function prose(body, fm) {
  const get = (re) => body.match(re)?.[1]?.trim() ?? null;
  const h1 = body.match(/^#\s+(.+)$/m)?.[1] ?? "";
  const name = fm?.name ?? (h1.replace(/^(DESIGN\.md|Design System)\s*[-:–—]\s*/i, "").trim() || null);
  const adjectives = get(/\*\*Adjectives:?\*\*:?\s*(.+)/i) ?? get(/^- Adjectives:\s*(.+)$/im);
  return {
    name: name || null,
    description: fm?.description ?? null,
    adjectives: adjectives ? adjectives.split(/[,·]/).map((s) => s.replace(/[.*]/g, "").trim()).filter(Boolean).slice(0, 6) : [],
    essence: get(/\*\*Essence:?\*\*:?\s*(.+)/i) ?? get(/Aesthetic essence:\s*(.+)/i),
    direction: get(/\*\*Aesthetic:?\*\*:?\s*(.+)/i) ?? get(/^- Direction:\s*(.+)$/im) ?? get(/^## Direction:?\s*(.+)$/im),
    signature: get(/\*\*Signature move:?\*\*:?\s*(.+)/i) ?? get(/^- Signature move:\s*(.+)$/im),
    dials: parseDials(get(/\*\*Dials:?\*\*:?\s*(.+)/i) ?? get(/Dials:\s*(.+)/i)),
  };
}

function parseDials(text) {
  if (!text) return null;
  const pick = (k) => Number(text.match(new RegExp(`${k}\\s*(\\d+)`, "i"))?.[1]) || null;
  return { variance: pick("variance"), motion: pick("motion"), density: pick("density") };
}

// Frontmatter colours → name→{value,file,selector} lookup, with `-dark` names
// split into the dark scope and component aliases mapped to roles.
export function frontmatterLookups(fm, path) {
  const light = new Map(), dark = new Map();
  for (const [name, value] of Object.entries(fm?.colors ?? {})) {
    const v = resolveAlias(value, fm);
    if (typeof v !== "string") continue;
    const entry = { value: v, file: path, selector: `frontmatter.colors.${name}` };
    if (/-dark$/.test(name)) dark.set(name.replace(/-dark$/, ""), entry);
    else light.set(name, entry);
  }
  const comp = fm?.components ?? {};
  const alias = (compName, prop, role) => {
    const raw = comp[compName]?.[prop];
    const v = resolveAlias(raw, fm);
    if (typeof v === "string" && !light.has(role)) light.set(role, { value: v, file: path, selector: `frontmatter.components.${compName}.${prop}` });
    // `{colors.x}` with a sibling `x-dark` colour gives the dark value of the same role.
    const ref = typeof raw === "string" && raw.match(/^\{colors\.([\w-]+)\}$/)?.[1];
    const darkValue = ref && fm.colors?.[`${ref}-dark`];
    if (typeof darkValue === "string" && !dark.has(role)) dark.set(role, { value: darkValue, file: path, selector: `frontmatter.colors.${ref}-dark` });
  };
  alias("button-primary", "backgroundColor", "accent");
  alias("button-primary", "textColor", "accent-fg");
  alias("card", "backgroundColor", "surface");
  alias("card", "textColor", "fg");
  return { light, dark };
}
