// Delivery targets: canvas, safe insets, duration/size/bitrate limits per platform.
// Safe insets are [top, right, bottom, left] fractions of height/width kept clear of
// platform UI; scenes are fitted inside the safe box, never the full canvas.
// Origin: a base preset table plus the additions in
// docs/research/ads-and-tutorials.md. Numbers a vendor only publishes as an overlay
// or a third-party sheet say so in `note`; verify them in the vendor's tool.

export const AUDIO_DEFAULT = Object.freeze({ lufs: -14, truePeak: -1, lra: 11, codec: "aac", kbps: 192, sampleRate: 48000, channels: 2 });

export const CRF = Object.freeze({ brand: 18, tutorial: 18, social: 18, ad: 20, capped: 23 });

export const CAPPED_BYTES = 100e6;

const LOUD = { lufs: AUDIO_DEFAULT.lufs, truePeak: AUDIO_DEFAULT.truePeak, lra: AUDIO_DEFAULT.lra };
const KB5120 = 5120 * 1024;

const BR = {
  meta: { target: 10000, max: 12000 },
  tiktok: { target: 5000, max: 6000 },
  youtube: { target: 10000, max: 12000 },
  x: { target: 9000, max: 25000 },
  linkedin: { target: 10000, max: 12000 },
  generic: { target: 10000, max: 12000 },
};

const sq = (f) => [f, f, f, f];
const px = (top, right, bottom, left, w, h) => [top / h, right / w, bottom / h, left / w];
const REELS_SAFE = px(220, 65, 420, 65, 1080, 1920);

const still = (o) => ({ kind: "still", ...o });
const motion = (o) => ({ fps: 30, loudness: LOUD, kind: "motion", ...o });
const both = (o) => motion({ kind: "both", ...o });

const entries = {
  still: { width: null, height: null, kind: "still", platform: "generic", group: "brand", safe: sq(0), maxBytes: null, note: "scene canvas as-is; pass {width,height} to safeBox" },
  brand: motion({ width: null, height: null, platform: "generic", group: "brand", safe: sq(0), duration: { min: 4, max: 8, ideal: 6 }, maxBytes: null, bitrateKbps: BR.generic, note: "scene canvas, alpha formats, 4-8 s loops" }),

  "ig-feed": both({ width: 1080, height: 1350, platform: "instagram", group: "social", safe: sq(0.04), duration: { min: 3, max: 60, ideal: 15 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "Meta: 4 GB max, 8-12 Mbps at 1080p; duration range is an estimate" }),
  "ig-square": both({ width: 1080, height: 1080, platform: "instagram", group: "social", safe: sq(0.04), duration: { min: 3, max: 60, ideal: 15 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "Meta: 4 GB max, 8-12 Mbps at 1080p; duration range is an estimate" }),
  reels: motion({ width: 1080, height: 1920, platform: "instagram", group: "social", safe: REELS_SAFE, duration: { min: 3, max: 90, ideal: 15 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "insets 220/65/420/65 px; the 420 px bottom is below Meta's ad zone, use reels-ad for paid" }),
  stories: motion({ width: 1080, height: 1920, platform: "instagram", group: "social", safe: px(250, 65, 250, 65, 1080, 1920), duration: { min: 1, max: 15, ideal: 10 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "insets 250/65/250/65 px; 15 s per card" }),
  tiktok: motion({ width: 1080, height: 1920, platform: "tiktok", group: "social", safe: px(108, 60, 320, 120, 1080, 1920), duration: { min: 3, max: 600, ideal: 15 }, maxBytes: 72e6, bitrateKbps: BR.tiktok, note: "72 MB is the Android cap (iOS 287.6 MB); 4-6 Mbps; safe insets from agency overlays, TikTok publishes overlay files only" }),
  shorts: motion({ width: 1080, height: 1920, platform: "youtube", group: "social", safe: REELS_SAFE, duration: { min: 1, max: 180, ideal: 30 }, maxBytes: 256e9, bitrateKbps: BR.youtube, fpsMax: 60, note: "Shorts up to 180 s; official YouTube encoding profile; safe box shared with reels" }),
  landscape: motion({ width: 1920, height: 1080, platform: "generic", group: "video", safe: sq(0.05), duration: { min: 3, max: 120, ideal: 30 }, maxBytes: null, bitrateKbps: BR.generic, fpsMax: 60, note: "generic 16:9 master" }),
  "linkedin-square": both({ width: 1080, height: 1080, platform: "linkedin", group: "social", safe: sq(0.04), duration: { min: 3, max: 900, ideal: 20 }, maxBytes: 200e6, bitrateKbps: BR.linkedin, note: "LinkedIn ads: 3 s-30 min, up to 200 MB; organic 15 min; 15-30 s ideal" }),
  "x-image": still({ width: 1200, height: 675, platform: "x", group: "social", safe: sq(0.04), maxBytes: 5e6, note: "X images up to 5 MB" }),
  "linkedin-image": still({ width: 1200, height: 627, platform: "linkedin", group: "social", safe: sq(0.04), maxBytes: 5e6, note: "5 MB cap is a third-party figure, not verified against LinkedIn" }),
  producthunt: still({ width: 1270, height: 760, platform: "producthunt", group: "brand", safe: sq(0.04), maxBytes: null, note: "gallery image; file cap not sourced" }),
  dribbble: still({ width: 1600, height: 1200, platform: "dribbble", group: "brand", safe: sq(0.05), maxBytes: null, note: "shot size; file cap not sourced" }),
  "behance-cover": still({ width: 1920, height: 1080, platform: "behance", group: "brand", safe: sq(0.05), maxBytes: null, note: "project cover; file cap not sourced" }),

  "reels-ad": motion({ width: 1080, height: 1920, platform: "instagram", group: "ad", safe: [0.14, 0.06, 0.35, 0.06], duration: { min: 3, max: 90, ideal: 15 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "vendor numbers: top 14% (269 px), bottom 35% (672 px), sides 6% (65 px); bottom 40% when a disclaimer shows; verify in Ads Manager" }),
  "stories-ad": motion({ width: 1080, height: 1920, platform: "instagram", group: "ad", safe: [0.14, 0.06, 0.35, 0.06], duration: { min: 3, max: 15, ideal: 10 }, maxBytes: 4e9, bitrateKbps: BR.meta, fpsMax: 60, note: "same Meta ad zone as reels-ad; 15 s per card; verify in Ads Manager" }),
  "tiktok-ad": motion({ width: 1080, height: 1920, platform: "tiktok", group: "ad", safe: px(130, 140, 480, 60, 1080, 1920), duration: { min: 5, max: 600, ideal: 15 }, maxBytes: 500e6, bitrateKbps: BR.tiktok, note: "agency measurements: top ~130, bottom ~480, right ~140 px; left 60 px copied from organic; min 540x960; min 516 kbps; min 5 s is an estimate" }),
  "shorts-ad": motion({ width: 1080, height: 1920, platform: "youtube", group: "ad", safe: [0.25, 1 / 12, 0.25, 1 / 12], duration: { min: 3, max: 180, ideal: 15 }, maxBytes: 256e9, bitrateKbps: BR.youtube, fpsMax: 60, note: "organic safe area is the central ~900x1350; ads are tighter, central 50% vertically (estimate)" }),
  "yt-thumbnail": still({ width: 1280, height: 720, platform: "youtube", group: "social", safe: sq(0.125), maxBytes: 2e6, note: "key content in the central 960x540; avoid the bottom-right (duration badge)" }),
  "yt-landscape": motion({ width: 1920, height: 1080, platform: "youtube", group: "video", safe: sq(0.05), duration: { min: 1, max: 43200, ideal: 120 }, maxBytes: 256e9, bitrateKbps: BR.youtube, fpsMax: 60, note: "official profile: 8 Mbps 1080p (12 HFR), H.264 High, AAC 384k; we send 10/12 Mbps; 12 h max is the verified-account limit, estimate; safe inset copied from landscape" }),
  "x-video": motion({ width: 1920, height: 1080, platform: "x", group: "video", safe: sq(0.05), duration: { min: 1, max: 140, ideal: 30 }, maxBytes: 512e6, bitrateKbps: BR.x, fpsMax: 60, note: "2:20 max, 512 MB, up to 25 Mbps (target 8-10), max 1920x1200; safe inset copied from landscape" }),
  "x-square": both({ width: 1080, height: 1080, platform: "x", group: "social", safe: [0.238, 0.04, 0.238, 0.04], duration: { min: 1, max: 140, ideal: 30 }, maxBytes: 5e6, bitrateKbps: BR.x, fpsMax: 60, note: "image cap 5 MB (video 512 MB); timeline previews crop to 1.91:1, so top/bottom inset = (1 - 1/1.91)/2 = 0.238" }),
  "x-landscape-image": still({ width: 1600, height: 900, platform: "x", group: "social", safe: sq(0.04), maxBytes: 5e6, note: "alternative to 1200x675" }),
  "linkedin-portrait": both({ width: 1080, height: 1350, platform: "linkedin", group: "social", safe: sq(0.04), duration: { min: 3, max: 900, ideal: 20 }, maxBytes: 200e6, bitrateKbps: BR.linkedin, note: "organic image or carousel slide; video 4:5 allowed" }),
  "linkedin-video": motion({ width: 1920, height: 1080, platform: "linkedin", group: "video", safe: sq(0.05), duration: { min: 3, max: 900, ideal: 20 }, maxBytes: 200e6, bitrateKbps: BR.linkedin, note: "ads 200 MB, 8-12 Mbps, H.264 + AAC 48 kHz; safe inset copied from landscape" }),
  "linkedin-document": { width: 1080, height: 1350, kind: "page", platform: "linkedin", group: "social", safe: sq(0.1), maxBytes: 100e6, pages: { min: 1, max: 300, ideal: 12 }, note: "PDF, RGB, same ratio every page, 10-20 pages best; carousel ads are strictly 1080x1080 and at most 10 cards; safe = centre 80%" },

  "gda-landscape": still({ width: 1200, height: 628, platform: "google", group: "ad", safe: sq(0.05), maxBytes: KB5120, minSize: { width: 600, height: 314 }, text: { shortHeadline: 30, longHeadline: 90, description: 90, businessName: 25 }, note: "may be cropped 5% on each side; headline x1-5, description x1-5" }),
  "gda-square": still({ width: 1200, height: 1200, platform: "google", group: "ad", safe: sq(0.05), maxBytes: KB5120, minSize: { width: 300, height: 300 }, text: { shortHeadline: 30, longHeadline: 90, description: 90, businessName: 25 }, note: "5% inset follows the landscape crop rule" }),
  "gda-portrait": still({ width: 960, height: 1200, platform: "google", group: "ad", safe: sq(0.05), maxBytes: KB5120, text: { shortHeadline: 30, longHeadline: 90, description: 90, businessName: 25 }, note: "Demand Gen only, optional; 5% inset is a default" }),
  "gda-logo-square": still({ width: 1200, height: 1200, platform: "google", group: "ad", safe: sq(0.05), maxBytes: KB5120, alpha: true, note: "transparent PNG; 5% padding is a default, not sourced" }),
  "gda-logo-landscape": still({ width: 1200, height: 300, platform: "google", group: "ad", safe: sq(0.05), maxBytes: KB5120, alpha: true, note: "transparent PNG 4:1; 5% padding is a default, not sourced" }),

  "pinterest-pin": both({ width: 1000, height: 1500, platform: "pinterest", group: "social", safe: sq(0.05), duration: { min: 4, max: 900, ideal: 15 }, maxBytes: 5e6, bitrateKbps: BR.generic, note: "image kept under 5 MB (video 2 GB, 4 s-15 min, 2:3/1:1/9:16); 5% inset is a default, not sourced" }),
  "threads-image": still({ width: 1080, height: 1350, platform: "threads", group: "social", safe: sq(0.04), maxBytes: 8e6, note: "1080x1350 or 1080x1080; carousel 2-20" }),
  "threads-video": motion({ width: 1080, height: 1920, platform: "threads", group: "social", safe: REELS_SAFE, duration: { min: 1, max: 300, ideal: 15 }, maxBytes: 1e9, bitrateKbps: BR.generic, note: "1 GB, 5 min; safe box copied from reels" }),
  "bluesky-image": still({ width: 1200, height: 627, platform: "bluesky", group: "social", safe: sq(0.04), maxBytes: 1e6, note: "1 MB (2 MB since Apr 2026, unverified); up to 4 images; JPEG q~80" }),
  "bluesky-video": motion({ width: 1920, height: 1080, platform: "bluesky", group: "social", safe: sq(0.05), duration: { min: 1, max: 180, ideal: 30 }, maxBytes: 100e6, bitrateKbps: BR.generic, note: "MP4 100-300 MB, 3 min; 1080x1920 and 1080x1080 are also accepted; 100 MB is the conservative end" }),

  "og-image": still({ width: 1200, height: 630, platform: "web", group: "web", safe: sq(0.05), maxBytes: 5e6, note: "5 MB follows the X large-card limit; 5% inset is a default" }),
  avatar: still({ width: 400, height: 400, platform: "web", group: "brand", safe: sq(0.15), maxBytes: null, note: "circular crop: the square inscribed in the circle has inset (1 - 1/sqrt2)/2 = 0.146" }),
  "app-store-screenshot": still({ width: 1290, height: 2796, platform: "apple", group: "web", safe: sq(0.05), maxBytes: null, note: "iPhone 6.7 inch, no alpha; file cap and inset not sourced" }),
  favicon: still({ width: 512, height: 512, platform: "web", group: "web", safe: sq(0.1), maxBytes: null, alpha: true, note: "maskable-icon safe zone is a circle of 80% diameter, so a 10% inset" }),
};

export const TARGETS = Object.freeze(entries);
export const TARGET_NAMES = Object.freeze(Object.keys(TARGETS));

export function target(name) {
  const t = TARGETS[name];
  if (!t) throw new Error(`Unknown target "${name}". Supported: ${TARGET_NAMES.join(", ")}`);
  return t;
}

// Targets with a null canvas (still, brand) need `dims` = { width, height }.
export function safeBox(name, dims = {}) {
  const t = target(name);
  const width = t.width ?? dims.width;
  const height = t.height ?? dims.height;
  if (!width || !height) throw new Error(`Target "${name}" has no fixed canvas: pass { width, height }`);
  const [top, right, bottom, left] = t.safe;
  const x = Math.round(left * width);
  const y = Math.round(top * height);
  return { x, y, w: width - x - Math.round(right * width), h: height - y - Math.round(bottom * height) };
}

export function targetsFor(kind) {
  const match = (k) => k === kind || (k === "both" && (kind === "motion" || kind === "still"));
  return TARGET_NAMES.filter((n) => match(TARGETS[n].kind));
}

// Output formats. "hyperframes" formats come straight from the renderer; the rest are
// ffmpeg transcodes of the RGBA png sequence.
export const FORMATS = Object.freeze({
  mp4: { via: "hyperframes", ext: "mp4", alpha: false },
  webm: { via: "ffmpeg", ext: "webm", alpha: true },
  mov: { via: "ffmpeg", ext: "mov", alpha: true },
  gif: { via: "ffmpeg", ext: "gif", alpha: false },
  webp: { via: "ffmpeg", ext: "webp", alpha: true },
  apng: { via: "ffmpeg", ext: "apng", alpha: true },
  png: { via: "still", ext: "png", alpha: true },
  "png-sequence": { via: "hyperframes", ext: "", alpha: true },
});

export const DEFAULT_FORMATS = Object.freeze({
  motion: ["mp4"],
  brand: ["webm", "mov", "apng", "png-sequence"],
  still: ["png"],
  page: ["png", "pdf"],
});
