// Pure motion engine of the guide overlay: camera windows, the pan dead zone,
// the cursor track and the typing reveal, all as functions of time.
//
// The same source runs in the composition: plan.mjs serializes every export
// into project/_shared/assets/guide-overlay.js (`window.GuideOverlay`), where
// the template samples it once per frame into GSAP keyframes. So: no imports,
// no module state, and a function may call only other exports of this file.
//
// Units: world = CSS px of the captured viewport (manifest coordinates).
// A camera is { cx, cy, z }: the world point at the screen centre and the zoom
// over the z = 1 framing. `view` is the world size the screen shows at z = 1,
// `bounds` the captured viewport; every window stays inside `bounds`.

export const OVERLAY = {
  intro: 1.5,
  outro: 1.5,
  enter: 0.5,
  exitLead: 0.2,
  exit: 0.55,
  zoomIn: 0.7,
  zoomOut: 0.7,
  panLead: 0.3,
  pan: 0.6,
  basePanMin: 0.45,
  deadZone: 0.15,
  maxZoom: 2.5,
  maxUpscale: 1.25,
  focusPad: 16,
  charSeconds: 0.05,
  crossfade: 0.25,
  ripple: { duration: 0.4, size: 48, stroke: 2 },
  spotlight: { dim: 0.45, pad: 10, radius: 14, fade: 0.25, hold: 0.4 },
};

// GSAP's power eases: powerN is a polynomial of degree N + 1.
export function ease(name, u) {
  const x = Math.min(1, Math.max(0, u));
  const m = /^power(\d)\.(in|out|inOut)$/.exec(name || "");
  if (!m) return x;
  const p = Number(m[1]) + 1;
  if (m[2] === "in") return x ** p;
  if (m[2] === "out") return 1 - (1 - x) ** p;
  return x < 0.5 ? (2 * x) ** p / 2 : 1 - (2 * (1 - x)) ** p / 2;
}

export function clamp(v, lo, hi) {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

export function typingSpan(chars) {
  return Math.round(Math.max(1, Number(chars) || 0) * OVERLAY.charSeconds * 1000) / 1000;
}

// The span a type step's afterPlate is revealed over, left to right, one step per character.
export function typingReveal(step) {
  const chars = step.typed?.chars ?? String(step.typed?.text ?? "").length;
  const b = step.bbox ?? { x: 0, y: 0, w: 0, h: 0 };
  const [x0, x1] = step.typed?.reveal ?? [b.x, b.x + b.w];
  const span = typingSpan(chars);
  return { start: step.clickAt, end: Math.round((step.clickAt + span) * 1000) / 1000, span, chars: Math.max(1, chars), x0, x1, y0: b.y, y1: b.y + b.h };
}

export function windowOf(cam, view) {
  return { cx: cam.cx, cy: cam.cy, w: view.w / cam.z, h: view.h / cam.z };
}

// True when the point sits inside the window shrunk by `dz` of its size on every side.
export function inDeadZone(point, win, dz = OVERLAY.deadZone) {
  const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
  const mx = win.w * dz, my = win.h * dz;
  return x >= win.cx - win.w / 2 + mx && x <= win.cx + win.w / 2 - mx && y >= win.cy - win.h / 2 + my && y <= win.cy + win.h / 2 - my;
}

export function containsBox(win, box, pad = 0) {
  if (!box) return true;
  return box.x - pad >= win.cx - win.w / 2 - 1e-6 && box.x + box.w + pad <= win.cx + win.w / 2 + 1e-6 &&
    box.y - pad >= win.cy - win.h / 2 - 1e-6 && box.y + box.h + pad <= win.cy + win.h / 2 + 1e-6;
}

export function stepPoint(step) {
  const c = step.center ?? step.path?.at?.(-1) ?? [0, 0];
  return [c[0], c[1]];
}

// The z = 1 framing for a step: the whole viewport when it fits, else a crop centred on the target.
export function baseWindow(step, view, bounds) {
  const [x, y] = stepPoint(step);
  return { cx: clamp(x, view.w / 2, bounds.w - view.w / 2), cy: clamp(y, view.h / 2, bounds.h - view.h / 2), z: 1 };
}

// Zoomed framing: scale the base framing around the target, then slide just
// enough to keep the padded target box whole, then stay inside the viewport.
export function fitWindow(step, z, view, bounds, base, pad = OVERLAY.focusPad) {
  const [x, y] = stepPoint(step);
  const w = view.w / z, h = view.h / z;
  let cx = x + (base.cx - x) / z, cy = y + (base.cy - y) / z;
  const b = step.bbox;
  if (b) {
    const fit = (c, lo, hi, size) => (hi - lo > size ? (lo + hi) / 2 : lo < c - size / 2 ? lo + size / 2 : hi > c + size / 2 ? hi - size / 2 : c);
    cx = fit(cx, b.x - pad, b.x + b.w + pad, w);
    cy = fit(cy, b.y - pad, b.y + b.h + pad, h);
  }
  return { cx: clamp(cx, w / 2, bounds.w - w / 2), cy: clamp(cy, h / 2, bounds.h - h / 2), z };
}

// Steps sharing a zoomGroup zoom in once, pan between targets, zoom out once.
export function zoomGroups(steps, maxZoom = OVERLAY.maxZoom) {
  const groups = [];
  steps.forEach((s, i) => {
    if (s.zoomGroup == null || s.zoomIn == null) return;
    let g = groups.find((x) => x.id === s.zoomGroup);
    if (!g) groups.push((g = { id: s.zoomGroup, steps: [], zoom: 1, zoomIn: s.zoomIn, zoomOut: s.zoomOut }));
    g.steps.push(i);
    g.zoom = Math.min(maxZoom, Math.max(g.zoom, s.zoom ?? 1));
    g.zoomOut = s.zoomOut;
  });
  return groups.filter((g) => g.zoom > 1);
}

export function boxPoint(box) {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

// The largest zoom at which the step's padded target and its result box still fit the frame.
export function fitZoom(step, view, pad = OVERLAY.focusPad) {
  const fit = (b) => (b ? Math.min(view.w / (b.w + 2 * pad), view.h / (b.h + 2 * pad)) : Infinity);
  return Math.min(fit(step.bbox), fit(step.resultBox));
}

// Inside a group: a later target pans the camera only when its centre leaves
// the dead zone of the current framing or its box is cut by the frame. A click
// whose result lands outside the framing pans to the result once the ripple settles,
// the group's last click too when the pan ends before the zoom closes.
export function planFocus(group, steps, view, bounds, bases) {
  const moves = [];
  let cur = null;
  for (const i of group.steps) {
    const s = steps[i];
    if (!cur) {
      cur = fitWindow(s, group.zoom, view, bounds, bases[i]);
      moves.push({ t0: group.zoomIn, t1: group.zoomIn, from: cur, to: cur });
    } else {
      const win = windowOf(cur, view);
      if (!(inDeadZone(stepPoint(s), win) && containsBox(win, s.bbox))) {
        const next = fitWindow(s, group.zoom, view, bounds, bases[i]);
        const t0 = s.clickAt - OVERLAY.panLead;
        moves.push({ t0, t1: t0 + OVERLAY.pan, from: cur, to: next, step: i });
        cur = next;
      }
    }
    const r = s.resultBox;
    const panEnds = s.clickAt + OVERLAY.ripple.duration + OVERLAY.pan;
    if (r && (i !== group.steps.at(-1) || panEnds <= group.zoomOut) && !containsBox(windowOf(cur, view), r)) {
      const next = fitWindow({ center: boxPoint(r), bbox: r }, group.zoom, view, bounds, bases[i]);
      const t0 = s.clickAt + OVERLAY.ripple.duration;
      moves.push({ t0, t1: t0 + OVERLAY.pan, from: cur, to: next, step: i, result: true });
      cur = next;
    }
  }
  return moves;
}

export function cameraPlan(steps, { view, bounds, maxZoom = OVERLAY.maxZoom }) {
  const bases = steps.map((s) => baseWindow(s, view, bounds));
  const baseMoves = [];
  let cur = bases[0];
  const moveTo = (to, t0, t1) => {
    if (Math.abs(cur.cx - to.cx) < 0.5 && Math.abs(cur.cy - to.cy) < 0.5) return;
    baseMoves.push({ t0, t1, from: cur, to });
    cur = to;
  };
  steps.forEach((s, i) => {
    if (i > 0) moveTo(bases[i], s.start, Math.max(s.clickAt, s.start + OVERLAY.basePanMin));
    const r = s.resultBox;
    if (r && !inDeadZone(boxPoint(r), windowOf(cur, view), 0)) {
      const t0 = s.clickAt + OVERLAY.ripple.duration;
      moveTo(baseWindow({ center: boxPoint(r) }, view, bounds), t0, t0 + OVERLAY.pan);
    }
  });
  const groups = zoomGroups(steps, maxZoom)
    .map((g) => ({ ...g, zoom: Math.min(g.zoom, ...g.steps.map((i) => fitZoom(steps[i], view))) }))
    .filter((g) => g.zoom > 1.05)
    .map((g) => ({ ...g, focus: planFocus(g, steps, view, bounds, bases) }));
  return { view, bounds, first: bases[0] ?? { cx: bounds.w / 2, cy: bounds.h / 2, z: 1 }, baseMoves, groups };
}

export function moveAt(moves, t, start, easeName) {
  let p = start;
  for (const m of moves) {
    if (t < m.t0) break;
    const u = m.t1 > m.t0 ? (t - m.t0) / (m.t1 - m.t0) : 1;
    const k = ease(easeName, u);
    p = { cx: m.from.cx + (m.to.cx - m.from.cx) * k, cy: m.from.cy + (m.to.cy - m.from.cy) * k };
  }
  return p;
}

// Zoom in and out interpolate the screen transform linearly, which makes each
// one a zoom about a single fixed point and keeps every window inside bounds.
export function cameraAt(plan, t) {
  const B = moveAt(plan.baseMoves, t, plan.first, "power2.inOut");
  const g = plan.groups.find((x) => t >= x.zoomIn && t < x.zoomOut + OVERLAY.zoomOut);
  if (!g) return { cx: B.cx, cy: B.cy, z: 1 };
  const F = moveAt(g.focus, t, g.focus[0].to, "power2.inOut");
  const Z = g.zoom;
  const u = t < g.zoomOut
    ? ease("power3.out", (t - g.zoomIn) / OVERLAY.zoomIn)
    : 1 - ease("power2.inOut", (t - g.zoomOut) / OVERLAY.zoomOut);
  const d = 1 + (Z - 1) * u;
  return { cx: (B.cx + (F.cx * Z - B.cx) * u) / d, cy: (B.cy + (F.cy * Z - B.cy) * u) / d, z: d };
}

// Screen transform for a world element laid out at `k` px per world unit with transform-origin 0 0.
export function cameraTransform(cam, screen, base, k = 1) {
  const S = base * cam.z;
  return { x: screen.w / 2 - cam.cx * S, y: screen.h / 2 - cam.cy * S, scale: S / k };
}

export function toScreen(p, cam, screen, base) {
  const S = base * cam.z;
  return { x: (p[0] - cam.cx) * S + screen.w / 2, y: (p[1] - cam.cy) * S + screen.h / 2 };
}

export function pathPoint(path, u) {
  if (!path?.length) return [0, 0];
  const f = Math.min(1, Math.max(0, u)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(f));
  if (i < 0) return [path[0][0], path[0][1]];
  const r = f - i;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * r, path[i][1] + (path[i + 1][1] - path[i][1]) * r];
}

// Cursor in world units: glides in from below the first framing, rides each
// step's path from start to clickAt, leaves through the bottom edge after the last step.
export function cursorPlan(steps, plan, { offscreen }) {
  const segs = [];
  if (!steps.length) return segs;
  const first = steps[0];
  const p0 = first.path?.[0] ?? stepPoint(first);
  const below = (cam, x) => [x, cam.cy + plan.view.h / (2 * cam.z) + offscreen];
  segs.push({ t0: first.start - OVERLAY.enter, t1: first.start, from: below(plan.first, p0[0]), to: [p0[0], p0[1]], ease: "power3.out" });
  let pos = [p0[0], p0[1]];
  for (const s of steps) {
    const end = s.path?.length ? s.path.at(-1) : pos;
    if (s.clickAt > s.start && s.path?.length > 1) segs.push({ t0: s.start, t1: s.clickAt, path: s.path, ease: "power2.inOut" });
    pos = [end[0], end[1]];
  }
  const last = steps.at(-1);
  const t0 = last.end - OVERLAY.exitLead;
  segs.push({ t0, t1: t0 + OVERLAY.exit, from: pos, to: below(cameraAt(plan, t0 + OVERLAY.exit), pos[0]), ease: "power2.in" });
  return segs;
}

export function cursorAt(segs, t) {
  if (!segs.length) return [0, 0];
  let p = segs[0].from ?? segs[0].path[0];
  for (const s of segs) {
    if (t < s.t0) break;
    const k = ease(s.ease, s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1);
    p = s.path ? pathPoint(s.path, k) : [s.from[0] + (s.to[0] - s.from[0]) * k, s.from[1] + (s.to[1] - s.from[1]) * k];
  }
  return p;
}

// One value per frame, frame 0 included: GSAP array keyframes put the first value at 0 %.
export function sampleFrames(duration, fps, fn) {
  const n = Math.max(1, Math.round(duration * fps));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(fn(i / fps));
  return out;
}
