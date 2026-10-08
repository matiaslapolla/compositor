import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doctor } from "../scripts/doctor.mjs";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontmatter = (text) => { const m = text.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(m, "frontmatter"); const out = {}; for (const line of m[1].split("\n")) { const k = line.match(/^([\w-]+):\s*(.*)$/); if (k) out[k[1]] = k[2]; } return out; };

test("every skill has a name matching its folder and a description under the listing cap", () => {
  const dir = join(plugin, "skills");
  const skills = readdirSync(dir);
  assert.ok(skills.length >= 8);
  for (const s of skills) {
    const fm = frontmatter(readFileSync(join(dir, s, "SKILL.md"), "utf8"));
    assert.equal(fm.name, s);
    assert.ok(fm.description.length > 40 && fm.description.length <= 1536, `${s} description length ${fm.description.length}`);
  }
});

test("agents declare name, description and a model tier", () => {
  const dir = join(plugin, "agents");
  for (const f of readdirSync(dir)) {
    const fm = frontmatter(readFileSync(join(dir, f), "utf8"));
    assert.equal(`${fm.name}.md`, f);
    assert.ok(["opus", "sonnet", "haiku"].includes(fm.model), `${f} model`);
    assert.ok(fm.description.length > 40);
  }
});

test("manifest, marketplace and hooks are well formed", () => {
  const manifest = JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "compositor");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const hooks = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8"));
  assert.ok(hooks.hooks.SessionStart[0].hooks[0].args[0].includes("${CLAUDE_PLUGIN_ROOT}"));
  const mkt = JSON.parse(readFileSync(join(plugin, "..", ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(mkt.plugins[0].source, "./plugin");
});

test("doctor reports node and the plugin deps", () => {
  const r = doctor();
  const ids = r.checks.map((c) => c.id);
  for (const id of ["node", "deps", "hyperframes", "ffmpeg", "chromium"]) assert.ok(ids.includes(id));
  assert.ok(r.checks.find((c) => c.id === "node").ok);
});

test("references the skills point to exist", () => {
  for (const f of ["run-contract.md", "brand.md", "rubric.md", "templates.md", "gates.md", "mark.md", "explain.md", "guide.md", "conventions.md"]) assert.ok(existsSync(join(plugin, "references", f)), f);
});

test("a render's timeout grows with its frame count, never under 20 minutes", async () => {
  const { renderTimeoutMs } = await import("../scripts/lib/hyperframes.mjs");
  assert.equal(renderTimeoutMs(180), 20 * 60_000);
  assert.equal(renderTimeoutMs(84.055 * 30), Math.ceil(84.055 * 30) * 2_000);
  assert.equal(renderTimeoutMs(undefined), 20 * 60_000);
});
