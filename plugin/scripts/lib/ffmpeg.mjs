import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

export function run(bin, args, { quiet = true, cwd } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd, maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    const tail = (r.stderr || "").split("\n").slice(-12).join("\n");
    throw new Error(`${bin} ${args.slice(0, 6).join(" ")}… exited ${r.status}\n${tail}`);
  }
  if (!quiet) process.stderr.write(r.stderr || "");
  return r.stdout;
}

export const ffmpeg = (args, opts) => run("ffmpeg", ["-v", "error", "-nostdin", ...args], opts);

// Structured probe: streams, format, derived fields used by the gates.
export function probe(path) {
  const out = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { encoding: "utf8" });
  const data = JSON.parse(out);
  const video = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");
  const fps = video?.r_frame_rate ? evalRatio(video.r_frame_rate) : null;
  const avgFps = video?.avg_frame_rate ? evalRatio(video.avg_frame_rate) : null;
  return {
    path,
    duration: Number(data.format?.duration ?? video?.duration ?? 0),
    size: Number(data.format?.size ?? 0),
    bitRate: Number(data.format?.bit_rate ?? 0),
    container: data.format?.format_name,
    video: video && {
      codec: video.codec_name,
      profile: video.profile,
      width: video.width,
      height: video.height,
      pixFmt: video.pix_fmt,
      fps,
      avgFps,
      frames: Number(video.nb_frames ?? 0) || (fps ? Math.round(Number(video.duration ?? data.format?.duration ?? 0) * fps) : null),
      colorPrimaries: video.color_primaries,
      colorTransfer: video.color_transfer,
      colorSpace: video.color_space,
      colorRange: video.color_range,
    },
    audio: audio && {
      codec: audio.codec_name,
      sampleRate: Number(audio.sample_rate),
      channels: audio.channels,
      bitRate: Number(audio.bit_rate ?? 0),
    },
    raw: data,
  };
}

function evalRatio(s) {
  const [a, b] = String(s).split("/").map(Number);
  return b ? a / b : a;
}

// EBU R128 measurement of the mixed audio: integrated LUFS, true peak dBTP, LRA.
export function loudness(path) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const text = r.stderr || "";
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const pick = (label) => {
    const m = summary.match(new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)`));
    return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : null;
  };
  return { integrated: pick("I"), range: pick("LRA"), truePeak: pick("Peak") };
}

// Two-pass loudnorm: pass 1 measures, returns the filter string for pass 2.
export function loudnormFilter(path, { I = -14, TP = -1, LRA = 11 } = {}) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-i", path, "-af", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const text = r.stderr || "";
  const start = text.lastIndexOf("{");
  const m = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  return `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
}

export function pngSequenceInfo(dir) {
  const frames = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
  if (!frames.length) throw new Error(`no png frames in ${dir}`);
  const m = frames[0].match(/^(.*?)(\d+)\.png$/i);
  if (!m) throw new Error(`unexpected frame name ${frames[0]}`);
  return { count: frames.length, pattern: `${m[1]}%0${m[2].length}d.png`, start: Number(m[2]), first: frames[0], last: frames.at(-1) };
}
