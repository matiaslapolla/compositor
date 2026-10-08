import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export function readJson(path, fallback) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

const SKIP = new Set(["node_modules", ".git", ".next", ".open-next", ".vercel", ".nuxt", ".svelte-kit", "out", "dist", "build", "storybook-static", ".worktrees", ".turbo", "coverage", ".compositor", "compositor", ".hyperframes", "snapshots", "renders"]);

// Depth-limited walk that skips build output. `match(relPath, name)` decides.
export function walk(root, match, { maxDepth = 6 } = {}) {
  const hits = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (match(relative(root, full), e.name)) hits.push(full);
    }
  };
  visit(root, 0);
  return hits;
}

export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "untitled";
}
