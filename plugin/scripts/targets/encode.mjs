// ffmpeg argument builders for every deliverable that starts from an RGBA png
// sequence (frame_%06d.png at the composition fps). Pure: no I/O, no spawning.
import { AUDIO_DEFAULT, CAPPED_BYTES, CRF, DEFAULT_FORMATS, target } from "./presets.mjs";

const AUDIO_KBPS = { social: AUDIO_DEFAULT.kbps, capped: AUDIO_DEFAULT.kbps, youtube: 384 };
const MIN_BITRATE_KBPS = 300;
// setparams stamps the frames: without it the png's unspecified primaries/trc override the output flags.
const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv";
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

// Smallest H.264 level whose frame size and macroblock rate fit the stream.
function h264Level(width, fps) {
  if (!width) return "4.1";
  const mbs = Math.ceil(width.w / 16) * Math.ceil(width.h / 16);
  const rate = mbs * fps;
  if (mbs <= 8192 && rate <= 245760) return "4.1";
  if (mbs <= 8704 && rate <= 522240) return "4.2";
  if (mbs <= 36864 && rate <= 983040) return "5.1";
  return "5.2";
}

function colorSource(background) {
  return /^#?[0-9a-f]{6}$/i.test(background) ? `0x${background.replace("#", "")}` : background;
}

export function encodeArgs(format, opts) {
  const { input, output, fps, width, crf = 18, background = null, audio = null, loudnormFilter = null, bitrateKbps = null, maxrateKbps = null, bufsizeKbps = null, pass = null, passlog = null, profile = "social", gifFps = 15, gifWidth = null } = opts;
  const src = ["-framerate", String(fps), "-i", input];
  switch (format) {
    case "mp4": {
      const gop = String(Math.round(fps / 2));
      const maxrate = maxrateKbps ?? (bitrateKbps ? Math.round(bitrateKbps * 1.2) : null);
      const rate = bitrateKbps
        ? ["-b:v", `${bitrateKbps}k`, "-maxrate", `${maxrate}k`, "-bufsize", `${bufsizeKbps ?? maxrate * 2}k`]
        : ["-crf", String(crf)];
      const passes = pass ? ["-pass", String(pass), "-passlogfile", passlog ?? `${output}.passlog`] : [];
      const video = [
        "-c:v", "libx264", "-profile:v", "high", "-level:v", h264Level(width, fps), "-preset", "slow",
        ...rate, ...passes,
        "-pix_fmt", "yuv420p", "-g", gop, "-keyint_min", gop, "-bf", "2", "-sc_threshold", "0",
        ...BT709,
      ];
      const graph = background
        ? ["-filter_complex", `color=c=${colorSource(background)}:s=${width.w}x${width.h}:r=${fps}[bg];[bg][0:v]overlay=format=auto:shortest=1,${EVEN}[v]`, "-map", "[v]"]
        : ["-vf", EVEN];
      if (pass === 1) return ["-y", ...src, ...graph, ...video, "-an", "-f", "null", "-"];
      const out = ["-movflags", "+faststart", "-map_metadata", "-1"];
      if (!audio) return ["-y", ...src, ...graph, ...video, "-an", ...out, output];
      const kbps = opts.audioKbps ?? AUDIO_KBPS[profile] ?? AUDIO_DEFAULT.kbps;
      const maps = background ? ["-map", "1:a:0"] : ["-map", "0:v:0", "-map", "1:a:0"];
      return [
        "-y", ...src, "-i", audio, ...graph, ...maps, ...video,
        "-c:a", "aac", "-b:a", `${kbps}k`, "-ar", String(AUDIO_DEFAULT.sampleRate), "-ac", String(AUDIO_DEFAULT.channels),
        ...(loudnormFilter ? ["-af", loudnormFilter] : []),
        "-shortest", ...out, output,
      ];
    }
    case "webm":
      return ["-y", ...src, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "24", "-row-mt", "1", output];
    case "mov":
      return ["-y", ...src, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0", output];
    case "webp":
      return ["-y", ...src, "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "85", "-loop", "0", output];
    case "apng":
      return ["-y", ...src, "-plays", "0", "-f", "apng", output];
    case "gif-palette": {
      const scale = gifWidth ? `,scale=${gifWidth}:-1:flags=lanczos` : "";
      return ["-y", ...src, "-vf", `fps=${gifFps}${scale},palettegen=stats_mode=diff:reserve_transparent=1`, output];
    }
    case "gif": {
      const scale = gifWidth ? `,scale=${gifWidth}:-1:flags=lanczos` : "";
      return ["-y", ...src, "-i", output.palette, "-lavfi", `fps=${gifFps}${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, "-loop", "0", output.file];
    }
    default:
      throw new Error(`no encoder for ${format}`);
  }
}

// One PNG to PNG/JPG/WebP by output extension. JPG has no alpha, so it flattens over
// white unless a background is given. `quality` is 1-100.
export function stillArgs({ input, output, background = null, quality = null }) {
  const ext = output.slice(output.lastIndexOf(".") + 1).toLowerCase();
  const jpg = ext === "jpg" || ext === "jpeg";
  if (!jpg && ext !== "png" && ext !== "webp") throw new Error(`no still encoder for .${ext}`);
  const bg = background ?? (jpg ? "#ffffff" : null);
  const flatten = bg
    ? ["-filter_complex", `[0:v]split[a][b];[b]drawbox=x=0:y=0:w=iw:h=ih:color=${colorSource(bg)}:t=fill[bg];[bg][a]overlay=format=auto[v]`, "-map", "[v]"]
    : [];
  let codec = [];
  if (jpg) codec = ["-q:v", String(quality ? Math.max(2, Math.round(2 + ((100 - quality) * 29) / 100)) : 2)];
  else if (ext === "webp") codec = ["-c:v", "libwebp", "-quality", String(quality ?? 90)];
  return ["-y", "-i", input, ...flatten, ...codec, "-frames:v", "1", "-update", "1", "-map_metadata", "-1", output];
}

export function bitrateForCap(maxBytes, durationS, audioKbps = AUDIO_DEFAULT.kbps) {
  return Math.floor((maxBytes * 8) / 1000 / durationS * 0.92 - audioKbps);
}

// `t` is a target name or entry. Ads encode at 20; capped targets (< 100 MB) at 23.
export function crfFor(mode, t = null) {
  const entry = typeof t === "string" ? target(t) : t;
  if (mode === "ad") return CRF.ad;
  if (entry?.maxBytes != null && entry.maxBytes < CAPPED_BYTES) return CRF.capped;
  return CRF[mode] ?? CRF.social;
}

// Ping-pong: forward frames then the reverse, dropping both turning points so no
// frame is shown twice in a row.
export function pingPongOrder(count) {
  const forward = Array.from({ length: count }, (_, i) => i + 1);
  const back = forward.slice(1, -1).reverse();
  return [...forward, ...back];
}

// Bitrate mode when YouTube's profile applies, the target is capped under 100 MB, or
// the guidance ceiling would overshoot the cap for this duration; otherwise CRF.
export function encodePlan(targetName, { durationS, audio = true } = {}) {
  const t = target(targetName);
  if (t.kind !== "motion" && t.kind !== "both") throw new Error(`Target "${targetName}" is a ${t.kind}, not a motion target`);
  const seconds = durationS ?? t.duration.ideal;
  const guidance = t.bitrateKbps;
  const youtube = t.platform === "youtube";
  const capped = t.maxBytes != null && t.maxBytes < CAPPED_BYTES;
  const profile = youtube ? "youtube" : capped ? "capped" : "social";
  const audioKbps = audio ? AUDIO_KBPS[profile] : 0;
  const mode = t.group === "ad" ? "ad" : t.group === "brand" ? "brand" : "social";
  const format = DEFAULT_FORMATS.motion[0];

  const overshoots = t.maxBytes != null && ((guidance.max + audioKbps) * 125 * seconds) > t.maxBytes * 0.92;
  if (!(youtube || capped || overshoots)) {
    return { target: targetName, format, crf: crfFor(mode, t), bitrateKbps: null, maxrateKbps: null, profile, audioKbps };
  }
  const ceiling = t.maxBytes != null ? bitrateForCap(t.maxBytes, seconds, audioKbps) : Infinity;
  const bitrate = Math.min(guidance.target, ceiling);
  if (bitrate < MIN_BITRATE_KBPS) throw new Error(`${seconds}s does not fit under ${t.maxBytes} bytes for "${targetName}"`);
  return { target: targetName, format, crf: null, bitrateKbps: bitrate, maxrateKbps: Math.min(guidance.max, Math.floor(bitrate * 1.2)), profile, audioKbps };
}
