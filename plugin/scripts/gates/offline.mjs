// Every reference in the authored project is local: no http(s) scripts, styles,
// fonts or media, and every @font-face url points at a file that exists.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { walk } from "../lib/fs.mjs";
import { finding, result, skip, cli, isMain } from "./common.mjs";

const GATE = "offline";

export function scanSource(path, text) {
  const findings = [];
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) findings.push(finding("offline.network", "fail", { file: path, url: m[1] }));
  for (const m of text.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi)) findings.push(finding("offline.network", "fail", { file: path, url: m[1] }));
  for (const m of text.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"')]+)/gi)) findings.push(finding("offline.network", "fail", { file: path, url: m[1] }));
  for (const m of text.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    for (const u of m[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const ref = u[1];
      if (/^(https?:|data:)/.test(ref)) continue;
      const file = resolve(dirname(path), ref.split("?")[0]);
      if (!existsSync(file)) findings.push(finding("offline.font-file", "fail", { file: path, url: ref }));
    }
  }
  return findings;
}

export async function run(ctx) {
  const project = join(ctx.runDir, "project");
  if (!existsSync(project)) return skip(GATE, "no project/");
  const sources = walk(project, (rel) => (rel.endsWith(".html") || rel.endsWith(".css")) && !rel.startsWith("_shared/") && !rel.includes("/fonts/"), { maxDepth: 3 });
  if (!sources.length) return skip(GATE, "no project/**/index.html");
  const findings = [];
  for (const file of sources) findings.push(...scanSource(file, readFileSync(file, "utf8")));
  return result(GATE, findings, { files: sources.length });
}

if (isMain(import.meta.url)) await cli(run);
