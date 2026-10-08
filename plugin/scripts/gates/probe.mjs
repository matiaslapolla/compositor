// ffprobe fields of every delivered file versus its target preset.
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { probe } from "../lib/ffmpeg.mjs";
import { walk } from "../lib/fs.mjs";
import { finding, result, skip, durationBounds, isStill, compositions, cli, isMain } from "./common.mjs";

const GATE = "probe";
export const VIDEO_EXT = new Set(["mp4", "webm", "mov", "gif", "m4v"]);
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);
const IMAGE_CODECS = new Set(["png", "mjpeg", "webp"]);
const DURATION_TOL = 0.1;

const extOf = (file) => extname(file).slice(1).toLowerCase();

// Pure comparison so it is testable without ffprobe. `info` is lib/ffmpeg probe().
export function compareProbe(info, target, { file, comp } = {}) {
  const out = [];
  const ext = extOf(file ?? info.path ?? "");
  const v = info.video ?? {};
  const still = isStill(comp, target);
  const at = file ?? info.path;
  const add = (rule, status, measured, expected) => out.push(finding(rule, status, { file: at, measured, expected }));

  if (still ? !IMAGE_EXT.has(ext) || (v.codec && !IMAGE_CODECS.has(v.codec)) : !VIDEO_EXT.has(ext)) {
    add("probe.format", "fail", { ext, codec: v.codec ?? null }, still ? "png|jpg|webp" : [...VIDEO_EXT].join("|"));
  }
  const width = target?.width ?? comp?.width;
  const height = target?.height ?? comp?.height;
  if (width && height && (v.width !== width || v.height !== height)) add("probe.dimensions", "fail", `${v.width}x${v.height}`, `${width}x${height}`);
  if (target?.maxBytes && info.size > target.maxBytes) add("probe.size", "fail", info.size, `<= ${target.maxBytes}`);
  if (still || !VIDEO_EXT.has(ext)) return out;

  if (v.width % 2 || v.height % 2) add("probe.even", "fail", `${v.width}x${v.height}`, "even width and height");
  const fps = comp?.fps ?? target?.fps;
  if (fps && ext !== "gif" && !(Math.abs((v.fps ?? 0) - fps) <= 0.01)) add("probe.fps", "fail", v.fps ?? null, fps);
  const { min, max } = durationBounds(target);
  if ((min != null && info.duration < min - DURATION_TOL) || (max != null && info.duration > max + DURATION_TOL)) {
    add("probe.duration", "fail", Number(info.duration.toFixed(3)), { min, max, tolerance: DURATION_TOL });
  }
  if (ext === "mp4" || ext === "m4v") {
    if (v.codec !== "h264") add("probe.codec", "fail", v.codec ?? null, "h264");
    if (v.pixFmt !== "yuv420p") add("probe.pix-fmt", "fail", v.pixFmt ?? null, "yuv420p");
    const tags = { primaries: v.colorPrimaries ?? null, transfer: v.colorTransfer ?? null, space: v.colorSpace ?? null };
    if (Object.values(tags).some((t) => t !== "bt709")) add("probe.bt709", "fail", tags, "bt709 primaries/transfer/space");
  }
  return out;
}

const mediaFiles = (dir) =>
  walk(dir, (rel) => !rel.startsWith("frames/") && (VIDEO_EXT.has(extOf(rel)) || IMAGE_EXT.has(extOf(rel))));

export async function run(ctx) {
  if (ctx.stage !== "dist") return skip(GATE, "probe runs on dist only");
  const dist = join(ctx.runDir, "dist");
  if (!existsSync(dist)) return result(GATE, [finding("probe.missing", "fail", { reason: "dist/ does not exist" })]);
  const dirs = readdirSync(dist).filter((d) => statSync(join(dist, d)).isDirectory());
  const names = [...new Set([...(ctx.plan?.targets ?? []), ...dirs])];
  const comps = compositions(ctx.plan);
  const findings = [];
  for (const name of names) {
    const dir = join(dist, name);
    const files = existsSync(dir) ? mediaFiles(dir) : [];
    const pdf = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".pdf")) : null;
    if (!files.length && pdf) {
      const pages = comps.filter((c) => c.target === name && c.page).length;
      findings.push(finding("probe.pages", pages ? "pass" : "warn", { target: name, file: pdf, slides: pages, note: "carousel PDF bundle; slides probed under <target>-NN" }));
      continue;
    }
    if (!files.length) {
      findings.push(finding("probe.missing", "fail", { target: name, reason: `no media files in dist/${name}/` }));
      continue;
    }
    // Carousel slides are delivered as <target>-NN; the PDF bundle sits under <target>/.
    const base = name.replace(/-\d{2}$/, "");
    const target = ctx.targets?.[name] ?? ctx.targets?.[base];
    if (!target) {
      findings.push(finding("probe.target", "skip", { target: name, reason: "no preset for this target" }));
      continue;
    }
    const comp = comps.find((c) => (c.name ?? c.target) === name) ?? comps.find((c) => c.target === base);
    for (const path of files) {
      const rel = relative(ctx.runDir, path);
      let info;
      try {
        info = probe(path);
      } catch (e) {
        if (/ENOENT/.test(e.message)) return skip(GATE, "ffprobe not available");
        findings.push(finding("probe.unreadable", "fail", { file: rel, error: e.message.split("\n")[0] }));
        continue;
      }
      findings.push(...compareProbe({ ...info, size: info.size || statSync(path).size }, target, { file: rel, comp }));
    }
  }
  return result(GATE, findings);
}

if (isMain(import.meta.url)) await cli(run);
