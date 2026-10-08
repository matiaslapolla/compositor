// Browser discovery: adds the HyperFrames-managed chrome-headless-shell to the search.
import { createRequire } from "node:module";
import { existsSync, realpathSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// CSS 3D under headless Chromium's default software path tiles; ANGLE +
// SwiftShader renders it correctly and deterministically.
export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--font-render-hinting=none",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--force-color-profile=srgb",
];

export function hyperframesRoot() {
  try {
    const bin = execSync("command -v hyperframes", { encoding: "utf8" }).trim();
    if (!bin) return null;
    return join(dirname(realpathSync(bin)), "..");
  } catch {
    return null;
  }
}

export function requireFromHyperframes(id) {
  for (const base of [null, hyperframesRoot()]) {
    try {
      const resolved = base ? require.resolve(id, { paths: [base] }) : id;
      return require(resolved);
    } catch {}
  }
  throw new Error(`${id} not found locally or in the global hyperframes install`);
}

export const loadPuppeteer = () => requireFromHyperframes("puppeteer-core");
export const loadSharp = () => requireFromHyperframes("sharp");

function newestDirMatching(root, prefix) {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((d) => d.startsWith(prefix)).sort();
  return dirs.length ? join(root, dirs.at(-1)) : null;
}

export function findChromium() {
  const env = process.env.COMPOSITOR_BROWSER_PATH || process.env.ISO_BROWSER_PATH || process.env.HYPERFRAMES_BROWSER_PATH;
  if (env && existsSync(env)) return env;
  for (const p of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (existsSync(p)) return p;
  }
  const hf = newestDirMatching(join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell"), "linux-");
  if (hf) {
    const p = join(hf, "chrome-headless-shell-linux64/chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  const pw = newestDirMatching(join(homedir(), ".cache/ms-playwright"), "chromium-");
  if (pw) {
    for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const p = join(pw, rel);
      if (existsSync(p)) return p;
    }
  }
  const pp = newestDirMatching(join(homedir(), ".cache/puppeteer/chrome"), "linux-");
  if (pp) {
    const p = join(pp, "chrome-linux64/chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium found. Install chromium or set COMPOSITOR_BROWSER_PATH.");
}

export async function launchBrowser(extraArgs = []) {
  const puppeteer = loadPuppeteer();
  return puppeteer.launch({ executablePath: findChromium(), headless: true, args: [...CHROMIUM_ARGS, ...extraArgs] });
}
