// motion-doctrine Seam Gate (`seam-gate.mjs verify`) when the project keeps a ledger.
import { existsSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HF_ENV } from "../lib/hyperframes.mjs";
import { findChromium } from "../lib/browser.mjs";
import { finding, result, skip, cli, isMain } from "./common.mjs";

const GATE = "seams";
export const SEAM_GATE = process.env.COMPOSITOR_SEAM_GATE || join(homedir(), ".claude/skills/motion-doctrine/scripts/seam-gate.mjs");
const STATUS = { FAIL: "fail", WARN: "warn", PASS: "pass" };

// The gate owns its preview server: a free port, attached (non-interactive `preview`
// detaches into a shared background server otherwise), ready once it serves this very
// directory. seam-gate's own random port can land on another session's server.
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

export async function startPreview(dir, { timeoutMs = 120_000 } = {}) {
  const port = await freePort();
  const child = spawn("npx", ["--no-install", "hyperframes", "preview", "--no-open", "--foreground", "--port", String(port)], {
    cwd: dir, env: { ...process.env, ...HF_ENV }, stdio: "ignore", detached: true,
  });
  const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} };
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const r = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(2000) });
      const own = (await r.json())?.projects?.find((p) => resolve(p.dir) === resolve(dir));
      if (own) return { base, compUrl: `${base}/api/projects/${own.id}/preview/comp/index.html`, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  stop();
  throw new Error(`preview server for ${dir} never became ready`);
}

// seam-gate --json prints [{ id, cut, type, rows: [{ check, status, detail }] }].
export function mapSeams(seams) {
  return seams.flatMap((s) =>
    s.rows.map((r) => finding(`seam.${r.check}`, STATUS[r.status] ?? "warn", { seam: s.id, cut: s.cut, type: s.type, detail: r.detail })),
  );
}

// project/ledger.json for a single project; project/<target>/ledger.json beside each built index.
export function ledgers(runDir) {
  const project = join(runDir, "project");
  if (existsSync(join(project, "ledger.json"))) return [{ name: null, dir: project, ledger: join(project, "ledger.json") }];
  if (!existsSync(project)) return [];
  return readdirSync(project)
    .filter((d) => !d.startsWith("_") && existsSync(join(project, d, "index.html")) && existsSync(join(project, d, "ledger.json")))
    .map((d) => ({ name: d, dir: join(project, d), ledger: join(project, d, "ledger.json") }));
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    return findChromium();
  } catch {
    return undefined;
  }
}

export async function run(ctx) {
  const found = ledgers(ctx.runDir);
  if (!found.length) return skip(GATE, "no project/ledger.json or project/<target>/ledger.json");
  if (!existsSync(SEAM_GATE)) return skip(GATE, `seam-gate.mjs not found at ${SEAM_GATE}`);
  const fps = ctx.plan?.compositions?.find((c) => c.fps)?.fps;
  const chrome = chromePath();
  const findings = [];
  let count = 0;
  for (const { name, dir, ledger } of found) {
    let server;
    try {
      server = await startPreview(dir);
    } catch (e) {
      findings.push(finding("seam.unavailable", "skip", { target: name, reason: e.message }));
      continue;
    }
    let r;
    try {
      r = spawnSync(process.execPath, [SEAM_GATE, "verify", "--ledger", ledger, "--url", server.base, "--comp-url", server.compUrl, "--json", ...(fps ? ["--fps", String(fps)] : [])], {
        cwd: dir, encoding: "utf8", env: { ...process.env, ...HF_ENV, ...(chrome ? { CHROME_PATH: chrome } : {}) }, maxBuffer: 1 << 26, timeout: 10 * 60_000,
      });
    } finally {
      server.stop();
    }
    const text = r.stdout || "";
    let seams;
    try {
      seams = JSON.parse(text.slice(text.indexOf("[")));
    } catch {
      const why = (r.stderr || text).trim().split("\n").at(-1) || `exit ${r.status}`;
      findings.push(finding(r.status === 2 ? "seam.unavailable" : "seam.error", r.status === 2 ? "skip" : "fail", { target: name, exit: r.status, reason: why }));
      continue;
    }
    count += seams.length;
    for (const f of mapSeams(seams)) findings.push(name ? { ...f, evidence: { target: name, ...f.evidence } } : f);
  }
  return result(GATE, findings, { seams: count, projects: found.length });
}

if (isMain(import.meta.url)) await cli(run);
