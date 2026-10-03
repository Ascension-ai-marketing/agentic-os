const DRINK = 'coffee';   // 'coffee' or 'tea': change this one word and the cup, its light and the end card all follow

/* Level 4 · B-roll in every size (Claude Design + Opus 5.5)
 * One scene, one pure function: SCENE.render(ctx, t, w, h) draws frame t of a 10 s seamless loop at any size.
 * The layout is a continuous function of the aspect ratio, so 16:9, 9:16 and 1:1 are real re-layouts (never crops)
 * and the player can morph between them live. Everything is drawn in code: no bitmaps, no generated footage.
 * Story: a cup steams; its steam draws the three platform screens; each fills with a tiny living world;
 * the steam winds back into the cup; "With enough coffee, anything is possible." */
(function () {
'use strict';
const DUR = 10, TAU = Math.PI * 2, K169 = Math.log(16 / 9);

/* ---------- math ---------- */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const sstep = (a, b, x) => { const k = inv(a, b, x); return k * k * (3 - 2 * k); };
const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = x => 1 - Math.pow(1 - x, 3);
const sine = x => 0.5 - 0.5 * Math.cos(Math.PI * x);
const om = n => (TAU * n) / DUR;                        // n whole cycles per loop keeps every wave seamless
function hash(i) {
  let x = Math.imul((i | 0) ^ 0x5bd1e995, 0x27d4eb2d);
  x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const h2 = (a, b) => hash(Math.imul(a | 0, 73856093) ^ Math.imul((b | 0) + 7, 19349663));
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(4)})`;

/* ---------- look ---------- */
const PAL = {
  coffee: { word: 'coffee', accent: hex('#F2A55E'), light: hex('#FFB877'), steam: hex('#FFF0DD') },
  tea:    { word: 'tea',    accent: hex('#E9BC5E'), light: hex('#FFC983'), steam: hex('#FFF4E1') },
};
const CREAM = hex('#F4EADB'), LINE = hex('#FCF2E4');

/* ---------- layout: three reference shapes, blended continuously by log(aspect) ----------
   x, y in px of the reference frame; sizes in px at a 1080 short side. screens: [cx, cy, height]. */
const REF = {
  wide:   { W: 1920, H: 1080, hero: [960, 742, 184], cup: [960, 852, 100], end: [292, 98],
            scr: [[960, 408, 392], [362, 452, 610], [1562, 452, 392]] },
  square: { W: 1080, H: 1080, hero: [540, 762, 148], cup: [540, 886, 74], end: [286, 76],
            scr: [[540, 284, 334], [186, 744, 430], [880, 768, 272]] },
  tall:   { W: 1080, H: 1920, hero: [540, 1372, 230], cup: [540, 1668, 116], end: [566, 90],
            scr: [[540, 440, 500], [285, 1135, 700], [790, 1062, 400]] },
};
const NORM = {};
for (const k in REF) {
  const r = REF[k], p = a => [a[0] / r.W, a[1] / r.H, a[2]];
  NORM[k] = { hero: p(r.hero), cup: p(r.cup), scr: r.scr.map(p), end: [r.end[0] / r.H, r.end[1]] };
}
function layout(w, h) {
  const la = Math.log(w / h), A = NORM.square, B = la >= 0 ? NORM.wide : NORM.tall, k = clamp(Math.abs(la) / K169);
  const u = Math.min(w, h) / 1080;
  const P = (a, b) => ({ x: lerp(a[0], b[0], k) * w, y: lerp(a[1], b[1], k) * h, s: lerp(a[2], b[2], k) * u });
  return { u, w, h, hero: P(A.hero, B.hero), cup: P(A.cup, B.cup), scr: A.scr.map((s, i) => P(s, B.scr[i])),
           endY: lerp(A.end[0], B.end[0], k) * h, endSize: lerp(A.end[1], B.end[1], k) * u };
}

/* ---------- timeline (seconds) ---------- */
const TL = {
  pull: [0.3, 1.65], push: [6.3, 7.7],            // camera: hero cup -> wide shot -> hero cup
  rib: [0.42, 0.6, 0.78], rise: 0.58, trace: 0.9, dev: 0.65,
  unravel: [6.0, 6.12, 6.24], pullIn: 1.3,        // the steam winds back into the cup
  swirl: [7.15, 8.5], text: [7.15, 7.95, 9.35, 9.85],   // line 1 in from 7.15, line 2 from 7.35; hold; out
};
const RATIO = [16 / 9, 9 / 16, 1];
const camK = t => (t < 4 ? ease(inv(TL.pull[0], TL.pull[1], t)) : 1 - ease(inv(TL.push[0], TL.push[1], t)));
function cupAt(L, t, drink) {
  const k = camK(t), tea = drink === 'tea';
  const x = lerp(L.hero.x, L.cup.x, k), y = lerp(L.hero.y, L.cup.y, k), R = lerp(L.hero.s, L.cup.s, k);
  return { x, y, R, k, tea, e: lerp(0.4, 0.34, k), lip: 0.035 * R, sy: y + (tea ? 0.12 : 0.1) * R };
}

/* ---------- offscreen layers ---------- */
const LAYERS = {};
function layer(name, w, h) {          // grow-only canvases: a size change never reallocates mid-sequence
  const cw = Math.max(1, Math.ceil(w)), ch = Math.max(1, Math.ceil(h));
  let L = LAYERS[name];
  if (!L) { const c = document.createElement('canvas'); L = LAYERS[name] = { c, x: c.getContext('2d', { willReadFrequently: !!window.SCENE_CPU }) }; }
  if (L.c.width < cw || L.c.height < ch) { L.c.width = Math.max(L.c.width, cw); L.c.height = Math.max(L.c.height, ch); }
  L.w = w; L.h = h;                    // the logical size in use this frame (top-left of the canvas)
  const x = L.x;
  if (x.reset) x.reset();          // every frame starts from a blank canvas AND default state: same t, same frame
  else { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, w, h); }
  return L;
}
const PUFF = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 12; i++) { const r = i / 12; g.addColorStop(r, `rgba(255,255,255,${(Math.exp(-r * r * 4) * (1 - r * r)).toFixed(4)})`); }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
})();
const TINTED = {};
function tinted(col) {               // the soft sprite, pre-tinted (for glows drawn straight onto the frame)
  const k = col.join(',');
  if (TINTED[k]) return TINTED[k];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.drawImage(PUFF, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = rgba(col, 1); x.fillRect(0, 0, 128, 128);
  return (TINTED[k] = c);
}
function puff(S, x, y, r, a) { if (a <= 0.003 || r <= 0.2) return; S.globalAlpha = Math.min(1, a); S.drawImage(PUFF, x - r, y - r, 2 * r, 2 * r); }
function tint(L, col) {
  const x = L.x; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-in';
  x.fillStyle = rgba(col, 1); x.fillRect(0, 0, L.c.width, L.c.height); x.globalCompositeOperation = 'source-over';
}
const GRAIN = [];
function grainTile(k) {
  if (GRAIN[k]) return GRAIN[k];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), img = x.createImageData(256, 256);
  for (let i = 0; i < 65536; i++) {
    const v = (h2(i, k * 5 + 1) + h2(i, k * 5 + 2) + h2(i, k * 5 + 3)) / 3 - 0.5;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.round(128 + v * 250); img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0); return (GRAIN[k] = c);
}
for (let k = 0; k < 3; k++) grainTile(k);      // made up front, never lazily mid-render

/* ---------- shapes ---------- */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU); }
function heart(ctx, x, y, s, sy = 1) {
  ctx.beginPath(); ctx.moveTo(x, y + 0.36 * s * sy);
  ctx.bezierCurveTo(x - 0.1 * s, y + 0.26 * s * sy, x - 0.5 * s, y + 0.03 * s * sy, x - 0.5 * s, y - 0.17 * s * sy);
  ctx.bezierCurveTo(x - 0.5 * s, y - 0.43 * s * sy, x - 0.14 * s, y - 0.48 * s * sy, x, y - 0.25 * s * sy);
  ctx.bezierCurveTo(x + 0.14 * s, y - 0.48 * s * sy, x + 0.5 * s, y - 0.43 * s * sy, x + 0.5 * s, y - 0.17 * s * sy);
  ctx.bezierCurveTo(x + 0.5 * s, y + 0.03 * s * sy, x + 0.1 * s, y + 0.26 * s * sy, x, y + 0.36 * s * sy);
  ctx.closePath();
}
function bez(p0, p1, p2, p3, q) {
  const a = 1 - q;
  return [a * a * a * p0[0] + 3 * a * a * q * p1[0] + 3 * a * q * q * p2[0] + q * q * q * p3[0],
          a * a * a * p0[1] + 3 * a * a * q * p1[1] + 3 * a * q * q * p2[1] + q * q * q * p3[1]];
}
/* a polyline with arc length: at(l) -> [x, y, tx, ty] */
function arcPath(pts) {
  const cum = [0];
  for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const L = cum[cum.length - 1];
  const at = l => {
    l = clamp(l, 0, L); let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= l) lo = m; else hi = m; }
    const k = (l - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]), a = pts[lo], b = pts[hi];
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    return [a[0] + tx * k, a[1] + ty * k, tx / tl, ty / tl];
  };
  return { pts, cum, L, at };
}
/* rounded-rect outline as an arc-length curve, starting top-centre, clockwise: at(s) -> [x, y, nx, ny] */
function outline(cx, cy, w, h) {
  const r = Math.min(w, h) * 0.055, l = cx - w / 2, tp = cy - h / 2, rt = cx + w / 2, bt = cy + h / 2, segs = [];
  const line = (x0, y0, x1, y1, nx, ny) => segs.push({ len: Math.hypot(x1 - x0, y1 - y0), f: k => [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, nx, ny] });
  const arc = (ax, ay, a0, a1) => segs.push({ len: Math.abs(a1 - a0) * r, f: k => { const a = a0 + (a1 - a0) * k, c = Math.cos(a), s = Math.sin(a); return [ax + r * c, ay + r * s, c, s]; } });
  line(cx, tp, rt - r, tp, 0, -1); arc(rt - r, tp + r, -Math.PI / 2, 0);
  line(rt, tp + r, rt, bt - r, 1, 0); arc(rt - r, bt - r, 0, Math.PI / 2);
  line(rt - r, bt, l + r, bt, 0, 1); arc(l + r, bt - r, Math.PI / 2, Math.PI);
  line(l, bt - r, l, tp + r, -1, 0); arc(l + r, tp + r, Math.PI, Math.PI * 1.5);
  line(l + r, tp, cx, tp, 0, -1);
  let P = 0; for (const g of segs) { g.at = P; P += g.len; }
  const at = s => {
    s = ((s % P) + P) % P;
    for (const g of segs) if (s <= g.at + g.len) return g.f(g.len > 0 ? (s - g.at) / g.len : 0);
    return segs[segs.length - 1].f(1);
  };
  const closest = (px, py) => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < 480; j++) { const s = (j / 480) * P, p = at(s), d = (p[0] - px) ** 2 + (p[1] - py) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  };
  return { cx, cy, w, h, r, l, tp, rt, bt, P, at, closest };
}

/* ---------- logos (real files, see logos.js) ---------- */
const LG = window.LOGOS || {};
const IG = new Image();
const ready = new Promise(res => { IG.onload = res; IG.onerror = res; setTimeout(res, 4000); });
if (LG.instagram) IG.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LG.instagram.svg.replace('<svg ', '<svg width="512" height="512" '));
const LOGO_P = {};
function drawLogo(ctx, name, x, y, hgt) {   // top-left anchored; returns the drawn width
  if (name === 'instagram') { if (IG.complete && IG.naturalWidth) ctx.drawImage(IG, x, y, hgt, hgt); return hgt; }
  const L = LG[name]; if (!L) return 0;
  const P = LOGO_P[name] || (LOGO_P[name] = L.paths.map(([d, f]) => [new Path2D(d), f]));
  const [vx, vy, , vh] = L.vb, k = hgt / vh;
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-vx, -vy);
  for (const [p, f] of P) { ctx.fillStyle = f; ctx.fill(p, L.rule || 'nonzero'); }
  ctx.restore(); return L.vb[2] * k;
}

/* ---------- type: Newsreader 500 at optical size 36, scaled to any size ---------- */
const OPSZ = 36;
const fontStr = it => `${it ? 'italic ' : ''}500 ${OPSZ}px Newsreader`;
function measure(ctx, str, it) { ctx.font = fontStr(it); return ctx.measureText(str).width; }

/* =====================================================================================================
   ROOM: near-black, warm key light from the upper left, a café out of focus behind, dust in the light,
   a table catching the light.
   ===================================================================================================== */
function drawRoom(ctx, w, h, L, cup, pal, t) {
  const R = cup.R, D = Math.hypot(w, h), u = L.u, m = Math.min(w, h);
  ctx.fillStyle = '#060403'; ctx.fillRect(0, 0, w, h);
  let g = ctx.createRadialGradient(0.2 * w, -0.15 * h, 0, 0.2 * w, -0.15 * h, 1.05 * D);
  g.addColorStop(0, rgba(pal.light, 0.15)); g.addColorStop(0.35, rgba(pal.light, 0.05)); g.addColorStop(0.75, rgba(pal.light, 0.008)); g.addColorStop(1, rgba(pal.light, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // a café far behind, out of focus: warm bokeh drifting on closed loops (seamless)
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let k = 0; k < 18; k++) {
    const hx = hash(k * 7 + 300), hy = hash(k * 7 + 301), hr = hash(k * 7 + 302);
    const x = (0.03 + 0.94 * hx + 0.012 * Math.sin(om(1) * t + k * 1.3)) * w;
    const y = cup.y - 0.12 * R - (0.06 + 0.88 * Math.pow(hy, 0.8)) * (cup.y - 0.12 * R) + 0.01 * h * Math.cos(om(1) * t + k);
    const r = (22 + 70 * hr * hr) * u, tw = 0.75 + 0.25 * Math.sin(om(2 + (k % 3)) * t + k * 2.4);
    const bright = hash(k * 7 + 303) > 0.78;
    const a = (bright ? 0.13 + 0.06 * hash(k * 7 + 304) : 0.035 + 0.04 * hash(k * 7 + 304)) * tw * (1.15 - 0.5 * hr);
    const col = [[255, 178, 98], [255, 206, 142], [244, 150, 78]][k % 3];
    const bg = ctx.createRadialGradient(x, y, 0, x, y, r);
    bg.addColorStop(0, rgba(col, a * 0.55)); bg.addColorStop(0.82, rgba(col, a * 0.8)); bg.addColorStop(0.93, rgba(col, a)); bg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // halo behind the cup so the steam glows against it
  g = ctx.createRadialGradient(cup.x, cup.y - 2.3 * R, 0, cup.x, cup.y - 2.3 * R, 5.2 * R);
  g.addColorStop(0, rgba(pal.light, 0.16)); g.addColorStop(0.45, rgba(pal.light, 0.055)); g.addColorStop(1, rgba(pal.light, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // table: far edge just above the rim, soft as if out of focus
  const ty = cup.y - 0.12 * R, soft = 0.55 * R, span = Math.max(1, h - ty + soft), f = x => clamp(x / span);
  g = ctx.createLinearGradient(0, ty - soft, 0, h);
  g.addColorStop(0, 'rgba(44,29,20,0)'); g.addColorStop(f(soft), 'rgba(44,29,20,0.95)');
  g.addColorStop(f(soft + 1.8 * R), 'rgba(27,18,12,0.97)'); g.addColorStop(1, 'rgba(10,7,5,1)');
  ctx.fillStyle = g; ctx.fillRect(0, ty - soft, w, h - ty + soft);
  ctx.save(); ctx.translate(cup.x - 0.4 * R, cup.y + 1.25 * R); ctx.scale(1, 0.27);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 4.8 * R);
  g.addColorStop(0, rgba(pal.light, 0.34)); g.addColorStop(0.4, rgba(pal.light, 0.12)); g.addColorStop(1, rgba(pal.light, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 4.8 * R, 0, TAU); ctx.fill(); ctx.restore();
  g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(6,4,3,0.6)'); g.addColorStop(0.28, 'rgba(6,4,3,0)'); g.addColorStop(0.72, 'rgba(6,4,3,0)'); g.addColorStop(1, 'rgba(6,4,3,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, ty - soft, w, h - ty + soft);
  // dust drifting in the light (closed loops: seamless)
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let k = 0; k < 46; k++) {
    const bx = hash(k * 3 + 900), by = hash(k * 3 + 901) * 0.8;
    const x = (bx + 0.018 * Math.sin(om(1) * t + k) + 0.008 * Math.sin(om(3) * t + k * 1.7)) * w;
    const y = (by + 0.022 * Math.sin(om(1) * t + k * 2.3) + 0.01 * Math.cos(om(2) * t + k)) * h;
    const lit = clamp(1.25 - Math.hypot(x / w - 0.25, y / h - 0.1) * 1.4);
    const a = lit * (0.25 + 0.3 * (0.5 + 0.5 * Math.sin(om(4 + (k % 3)) * t + k * 2.1)));
    if (a <= 0.01) continue;
    const r = (1.4 + 2.2 * hash(k * 3 + 902)) * u;
    ctx.globalAlpha = a; ctx.drawImage(PUFF, x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.restore();
}

/* =====================================================================================================
   THE CUP: cream ceramic, 3/4 view from a little above. Coffee = cappuccino cup with a latte heart;
   tea = flared porcelain teacup, gold rim, a tea bag tag over the side.
   ===================================================================================================== */
function drawCup(ctx, cup, pal, t) {
  const { x: cx, y: cy, R, e, tea } = cup;
  const Hb = tea ? 0.74 * R : 0.9 * R, rf = tea ? 0.4 * R : 0.52 * R;
  const footY = cy + Hb, sy = footY + (tea ? 0.1 : 0.05) * R, sR = 1.6 * R, se = e * 0.92;
  let g;
  // long soft shadow on the table, thrown to the lower right
  ctx.save(); ctx.translate(cx + 0.75 * R, sy + 0.24 * R); ctx.scale(1, 0.22);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 2.6 * R);
  g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(0.55, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 2.6 * R, 0, TAU); ctx.fill(); ctx.restore();

  // saucer: the edge band, then the lit top
  ellipse(ctx, cx, sy + 0.1 * R, sR * 0.99, sR * se);
  g = ctx.createLinearGradient(cx - sR, 0, cx + sR, 0);
  g.addColorStop(0, '#4A4038'); g.addColorStop(0.28, '#7D7164'); g.addColorStop(0.62, '#3E352E'); g.addColorStop(1, '#1B1512');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.translate(cx, sy); ctx.scale(1, se);
  g = ctx.createRadialGradient(-0.42 * sR, -0.55 * sR, 0, -0.1 * sR, -0.1 * sR, 1.55 * sR);
  g.addColorStop(0, tea ? '#FBF5EB' : '#EEE4D4'); g.addColorStop(0.3, tea ? '#D6CCBD' : '#C7BAA7'); g.addColorStop(0.62, '#7F7265'); g.addColorStop(1, '#362E28');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sR, 0, TAU); ctx.fill();
  // well
  g = ctx.createRadialGradient(0, 0, 0.5 * sR, 0, 0, 0.7 * sR);
  g.addColorStop(0, 'rgba(60,48,40,0)'); g.addColorStop(0.8, 'rgba(60,48,40,0.22)'); g.addColorStop(1, 'rgba(255,248,236,0.12)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.7 * sR, 0, TAU); ctx.fill();
  ctx.restore();
  // lit rim of the saucer (back-left catches the light)
  ctx.save(); ellipse(ctx, cx, sy, sR, sR * se); ctx.clip();
  ellipse(ctx, cx + 0.02 * R, sy + 0.025 * R, sR * 0.975, sR * 0.975 * se);
  g = ctx.createLinearGradient(cx - sR, 0, cx + sR, 0);
  g.addColorStop(0, 'rgba(255,250,240,0.75)'); g.addColorStop(0.45, 'rgba(255,250,240,0.25)'); g.addColorStop(1, 'rgba(255,250,240,0.04)');
  ctx.strokeStyle = g; ctx.lineWidth = 0.04 * R; ctx.stroke(); ctx.restore();
  if (tea) { ellipse(ctx, cx, sy, sR * 0.994, sR * 0.994 * se); ctx.strokeStyle = rgba(pal.accent, 0.8); ctx.lineWidth = 0.022 * R; ctx.stroke(); }
  // contact shadow of the cup on the saucer
  ctx.save(); ctx.translate(cx + 0.14 * R, footY + 0.05 * R); ctx.scale(1, e * 0.85);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, rf * 2.1);
  g.addColorStop(0, 'rgba(26,17,12,0.8)'); g.addColorStop(0.5, 'rgba(26,17,12,0.35)'); g.addColorStop(1, 'rgba(26,17,12,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rf * 2.1, 0, TAU); ctx.fill(); ctx.restore();
  if (tea) { // foot ring
    ctx.beginPath(); ctx.moveTo(cx - rf * 0.92, footY - 0.02 * R); ctx.lineTo(cx - rf * 0.88, footY + 0.1 * R);
    ctx.ellipse(cx, footY + 0.1 * R, rf * 0.88, rf * 0.88 * e, 0, Math.PI, 0, true); ctx.lineTo(cx + rf * 0.92, footY - 0.02 * R); ctx.closePath();
    g = ctx.createLinearGradient(cx - rf, 0, cx + rf, 0);
    g.addColorStop(0, '#8E8272'); g.addColorStop(0.3, '#D8CDBC'); g.addColorStop(0.75, '#7A6E61'); g.addColorStop(1, '#3E352E');
    ctx.fillStyle = g; ctx.fill();
  }

  // handle (behind the body's right edge)
  const hand = new Path2D();
  if (tea) { hand.moveTo(cx + 0.9 * R, cy + 0.1 * R); hand.bezierCurveTo(cx + 1.5 * R, cy - 0.02 * R, cx + 1.44 * R, cy + 0.6 * R, cx + 0.66 * R, cy + 0.5 * R); }
  else { hand.moveTo(cx + 0.9 * R, cy + 0.14 * R); hand.bezierCurveTo(cx + 1.6 * R, cy + 0.02 * R, cx + 1.58 * R, cy + 0.8 * R, cx + 0.74 * R, cy + 0.68 * R); }
  ctx.save(); ctx.lineCap = 'round';
  g = ctx.createLinearGradient(cx + 0.9 * R, cy, cx + 1.5 * R, cy + 0.75 * R);
  g.addColorStop(0, '#E4DACA'); g.addColorStop(0.45, '#A39684'); g.addColorStop(1, '#362E28');
  ctx.strokeStyle = g; ctx.lineWidth = (tea ? 0.12 : 0.18) * R; ctx.stroke(hand);
  ctx.strokeStyle = 'rgba(34,27,22,0.4)'; ctx.lineWidth = (tea ? 0.05 : 0.07) * R;
  ctx.save(); ctx.translate(0.028 * R, 0.04 * R); ctx.stroke(hand); ctx.restore();
  ctx.strokeStyle = 'rgba(255,250,240,0.5)'; ctx.lineWidth = 0.026 * R;
  ctx.save(); ctx.translate(-0.022 * R, -0.03 * R); ctx.stroke(hand); ctx.restore();
  if (tea) { ctx.beginPath(); ctx.moveTo(cx + 1.02 * R, cy + 0.05 * R); ctx.lineTo(cx + 1.2 * R, cy + 0.0 * R); ctx.strokeStyle = '#CFC4B3'; ctx.lineWidth = 0.07 * R; ctx.stroke(); }
  ctx.restore();

  // body
  const side = new Path2D(), body = new Path2D();
  const curve = (p, dir) => {
    if (tea) dir > 0 ? p.bezierCurveTo(cx + 0.64 * R, cy + 0.92 * Hb, cx + 0.98 * R, cy + 0.36 * Hb, cx + R, cy)
                     : p.bezierCurveTo(cx - 0.98 * R, cy + 0.36 * Hb, cx - 0.64 * R, cy + 0.92 * Hb, cx - rf, footY);
    else dir > 0 ? p.bezierCurveTo(cx + 0.8 * R, cy + Hb, cx + R, cy + 0.56 * Hb, cx + R, cy)
                 : p.bezierCurveTo(cx - R, cy + 0.56 * Hb, cx - 0.8 * R, cy + Hb, cx - rf, footY);
  };
  body.moveTo(cx - R, cy); curve(body, -1);
  body.ellipse(cx, footY, rf, rf * e, 0, Math.PI, 0, true); curve(body, 1);
  body.ellipse(cx, cy, R, R * e, 0, 0, Math.PI, false); body.closePath();
  g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  if (tea) {   // thin white porcelain
    g.addColorStop(0, '#6A5E53'); g.addColorStop(0.08, '#D6CBBB'); g.addColorStop(0.22, '#FFFAF1'); g.addColorStop(0.42, '#F1E8DA');
    g.addColorStop(0.64, '#C2B3A0'); g.addColorStop(0.86, '#62554A'); g.addColorStop(1, '#3A3029');
  } else {     // matte cream stoneware
    g.addColorStop(0, '#574A3F'); g.addColorStop(0.08, '#BEAF9C'); g.addColorStop(0.22, '#F7EFE3'); g.addColorStop(0.4, '#E6D9C6');
    g.addColorStop(0.62, '#B29F89'); g.addColorStop(0.84, '#52453A'); g.addColorStop(1, '#2A211C');
  }
  ctx.fillStyle = g; ctx.fill(body);
  g = ctx.createLinearGradient(0, cy, 0, footY + rf * e);
  g.addColorStop(0, 'rgba(20,12,8,0)'); g.addColorStop(0.6, 'rgba(20,12,8,0.1)'); g.addColorStop(1, 'rgba(20,12,8,0.52)');
  ctx.fillStyle = g; ctx.fill(body);
  ctx.save(); ctx.clip(body);
  ctx.save(); ctx.translate(cx - 0.5 * R, cy + 0.4 * Hb); ctx.scale(0.15, 1);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.52 * Hb);
  g.addColorStop(0, 'rgba(255,252,246,0.6)'); g.addColorStop(1, 'rgba(255,252,246,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.52 * Hb, 0, TAU); ctx.fill(); ctx.restore();
  side.moveTo(cx + rf, footY);
  if (tea) side.bezierCurveTo(cx + 0.64 * R, cy + 0.92 * Hb, cx + 0.98 * R, cy + 0.36 * Hb, cx + R, cy);
  else side.bezierCurveTo(cx + 0.8 * R, cy + Hb, cx + R, cy + 0.56 * Hb, cx + R, cy);
  ctx.strokeStyle = rgba(pal.light, 0.3); ctx.lineWidth = 0.05 * R; ctx.stroke(side);
  ctx.restore();

  // interior + liquid
  const iR = R - cup.lip;
  ellipse(ctx, cx, cy, iR, iR * e);
  g = ctx.createLinearGradient(cx - iR, 0, cx + iR, 0);
  g.addColorStop(0, '#4A4038'); g.addColorStop(0.5, '#958878'); g.addColorStop(1, '#E0D5C4');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ellipse(ctx, cx, cy, iR, iR * e); ctx.clip();
  const lR = iR * 0.985;
  ctx.save(); ctx.translate(cx, cup.sy); ctx.scale(1, e);
  ctx.beginPath(); ctx.arc(0, 0, lR, 0, TAU);
  if (tea) {
    g = ctx.createRadialGradient(-0.15 * lR, -0.2 * lR, 0, 0, 0, lR);
    g.addColorStop(0, '#D98E3E'); g.addColorStop(0.45, '#AD5E20'); g.addColorStop(0.85, '#6C3410'); g.addColorStop(1, '#3E1D09');
  } else {
    g = ctx.createRadialGradient(-0.1 * lR, -0.1 * lR, 0, 0, 0, lR);
    g.addColorStop(0, '#C9955F'); g.addColorStop(0.5, '#A06739'); g.addColorStop(0.83, '#6A391B'); g.addColorStop(1, '#361B0C');
  }
  ctx.fillStyle = g; ctx.fill();
  const sw = TAU * ease(inv(TL.swirl[0], TL.swirl[1], t));     // exactly one turn: ends where it began
  if (!tea) latteHeart(ctx, lR, sw, e); else teaSurface(ctx, lR, sw);
  const rp = inv(7.3, 8.6, t);
  if (rp > 0 && rp < 1) {
    ctx.strokeStyle = `rgba(255,236,210,${(0.4 * (1 - rp)).toFixed(3)})`; ctx.lineWidth = 0.03 * R;
    ctx.beginPath(); ctx.arc(0, 0, lR * (0.1 + 0.86 * easeOut(rp)), 0, TAU); ctx.stroke();
  }
  g = ctx.createRadialGradient(-0.45 * lR, -0.55 * lR, 0, -0.45 * lR, -0.55 * lR, 0.6 * lR);
  g.addColorStop(0, `rgba(255,244,228,${tea ? 0.42 : 0.22})`); g.addColorStop(1, 'rgba(255,244,228,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, lR, 0, TAU); ctx.fill();
  ctx.restore();
  // the back rim shades the far edge of the liquid
  g = ctx.createLinearGradient(0, cy - iR * e, 0, cup.sy);
  g.addColorStop(0, 'rgba(20,10,5,0.45)'); g.addColorStop(1, 'rgba(20,10,5,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - iR, cy - iR * e, 2 * iR, cup.sy - cy + iR * e);
  ctx.restore();

  // rim lip
  ellipse(ctx, cx, cy, R - cup.lip * 0.5, (R - cup.lip * 0.5) * e);
  g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  g.addColorStop(0, 'rgba(255,250,240,0.95)'); g.addColorStop(0.45, 'rgba(240,230,215,0.82)'); g.addColorStop(1, 'rgba(140,128,112,0.8)');
  ctx.strokeStyle = g; ctx.lineWidth = cup.lip * 1.1; ctx.stroke();
  if (tea) { ellipse(ctx, cx, cy, R, R * e); ctx.strokeStyle = rgba(pal.accent, 0.95); ctx.lineWidth = 0.02 * R; ctx.stroke(); }

  if (tea) teaTag(ctx, cup, pal, t);
}
function latteHeart(ctx, lR, sw, e) {
  ctx.save(); ctx.rotate(0.1 + sw);
  const k = Math.sin(Math.PI * clamp(sw / TAU));
  if (k > 0.01) {                               // crema streaks while it turns
    ctx.strokeStyle = `rgba(92,52,25,${(0.4 * k).toFixed(3)})`; ctx.lineWidth = 0.04 * lR;
    for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(0, 0, lR * (0.55 + 0.13 * j), j * 2, j * 2 + 2.3); ctx.stroke(); }
  }
  const s = lR * 1.22, sy = 1.3, y0 = 0.02 * lR;  // pre-stretched so it still reads as a heart in perspective
  ctx.filter = `blur(${(0.05 * lR).toFixed(2)}px)`;
  ctx.fillStyle = 'rgba(220,178,128,0.5)'; heart(ctx, 0, y0, s * 1.1, sy); ctx.fill();
  ctx.filter = `blur(${(0.012 * lR).toFixed(2)}px)`;
  const g = ctx.createRadialGradient(-0.1 * s, -0.12 * s, 0, 0, 0, 0.62 * s);
  g.addColorStop(0, '#FBF4EA'); g.addColorStop(0.7, '#F1E4CF'); g.addColorStop(1, '#E2CDAE');
  ctx.fillStyle = g; heart(ctx, 0, y0, s, sy); ctx.fill();
  ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(241,228,207,0.9)'; ctx.lineWidth = 0.035 * lR;
  ctx.beginPath(); ctx.moveTo(0, y0 + 0.34 * s * sy); ctx.quadraticCurveTo(0.02 * s, y0 + 0.5 * s * sy, -0.01 * s, y0 + 0.62 * s * sy); ctx.stroke();
  ctx.filter = 'none';
  ctx.restore();
}

function teaSurface(ctx, lR, sw) {
  const k = Math.sin(Math.PI * clamp(sw / TAU));
  if (k <= 0.01) return;
  ctx.save(); ctx.rotate(sw);
  ctx.strokeStyle = `rgba(255,214,150,${(0.32 * k).toFixed(3)})`; ctx.lineWidth = 0.03 * lR;
  for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(0, 0, lR * (0.35 + 0.18 * j), j * 2.1, j * 2.1 + 2.4); ctx.stroke(); }
  ctx.restore();
}
function teaTag(ctx, cup, pal, t) {
  const { x: cx, y: cy, R, e } = cup;
  const a = 2.35, lx = cx + R * Math.cos(a), ly = cy + R * e * Math.sin(a);       // where the string crosses the lip
  const sway = 0.07 * Math.sin(om(2) * t + 0.6) + 0.03 * Math.sin(om(5) * t);
  const tx = lx - 0.05 * R + Math.sin(sway) * 0.45 * R, ty = ly + 0.36 * R;          // tag top, resting against the cup
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(236,226,206,0.9)'; ctx.lineWidth = Math.max(1, 0.012 * R);
  ctx.beginPath(); ctx.moveTo(cx - 0.25 * R, cup.sy + 0.02 * R); ctx.quadraticCurveTo(lx + 0.2 * R, ly - 0.12 * R, lx, ly);
  ctx.quadraticCurveTo(lx - 0.06 * R, ly + 0.2 * R, tx, ty); ctx.stroke();
  ctx.translate(tx, ty); ctx.rotate(sway * 0.8);
  const tw = 0.36 * R, th = 0.44 * R;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 0.08 * R; ctx.shadowOffsetY = 0.03 * R;
  let g = ctx.createLinearGradient(-tw / 2, 0, tw / 2, th);
  g.addColorStop(0, '#F5EBD6'); g.addColorStop(1, '#CDBE9F');
  ctx.fillStyle = g; rr(ctx, -tw / 2, 0, tw, th, 0.02 * R); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = rgba(pal.accent, 0.9); ctx.lineWidth = Math.max(0.8, 0.012 * R);
  rr(ctx, -tw / 2 + 0.035 * R, 0.035 * R, tw - 0.07 * R, th - 0.07 * R, 0.01 * R); ctx.stroke();
  ctx.fillStyle = rgba(pal.accent, 0.95);
  ctx.beginPath(); ctx.moveTo(0, th * 0.34); ctx.quadraticCurveTo(tw * 0.28, th * 0.5, 0, th * 0.76); ctx.quadraticCurveTo(-tw * 0.28, th * 0.5, 0, th * 0.34); ctx.fill();
  ctx.strokeStyle = 'rgba(245,235,214,0.9)'; ctx.lineWidth = Math.max(0.6, 0.008 * R);
  ctx.beginPath(); ctx.moveTo(0, th * 0.38); ctx.lineTo(0, th * 0.72); ctx.stroke();
  ctx.fillStyle = '#9C958A'; ctx.fillRect(-0.035 * R, 0.01 * R, 0.07 * R, 0.022 * R);
  ctx.restore();
}

/* =====================================================================================================
   STEAM: soft volume (quarter-res puffs) + twisting sheets whose edges turn into bright filaments
   where a sheet turns edge-on (half-res). Tinted warm and screened on.
   ===================================================================================================== */
function ambientSteam(S, F, cup, t, amp, u, hMul) {
  const R = cup.R, N = 44, NW = 6, sc = Math.sqrt(R / (100 * u));
  for (let i = 0; i < NW; i++) {
    const sd = i * 17 + 3;
    const bx = cup.x + R * (-0.46 + (0.92 * (i + 0.5)) / NW + (hash(sd) - 0.5) * 0.12);
    const Hw = R * (2.4 + 1.9 * hash(sd + 1)) * hMul;
    const wax = 0.5 + 0.5 * Math.sin(om(1 + (i % 3)) * t + hash(sd + 2) * TAU);
    const A = amp * (0.25 + 0.75 * wax);
    if (A < 0.01) continue;
    const sp = [];
    for (let j = 0; j <= N; j++) {
      const s = j / N, cu = sstep(0.35, 1, s) * R * 0.24, ph3 = TAU * 1.3 * s - om(7) * t + hash(sd + 8) * TAU;
      const x = bx + R * (0.16 * Math.pow(s, 1.1) * Math.sin(TAU * 0.75 * s - om(5) * t + hash(sd + 3) * TAU)
        + 0.06 * Math.pow(s, 1.4) * Math.sin(TAU * 1.9 * s - om(9) * t + hash(sd + 4) * TAU)
        + 0.4 * s * s * (hash(sd + 5) - 0.42)) + cu * Math.cos(ph3);
      const y = cup.sy - 0.02 * R - s * Hw + cu * 0.6 * Math.sin(ph3);
      const a = inv(0, 0.1, s) * Math.pow(1 - s, 1.2) * (0.35 + 0.65 * sstep(-0.2, 0.9, Math.sin(TAU * 1.9 * s - om(8) * t + hash(sd + 6) * TAU)));
      // the veil twists slowly and irregularly: wide and faint face-on, a bright thread where it turns edge-on
      const tw = TAU * (0.5 * s + 0.22 * Math.sin(TAU * 0.6 * s + hash(sd + 9) * TAU)) - om(4) * t + hash(sd + 10) * TAU;
      const face = Math.abs(Math.sin(tw));
      sp.push({ x, y, a, s, face, nx: 0, ny: 0 });
    }
    for (let j = 0; j <= N; j++) {
      const p = sp[Math.max(0, j - 1)], q = sp[Math.min(N, j + 1)], nx = -(q.y - p.y), ny = q.x - p.x, l = Math.hypot(nx, ny) || 1;
      sp[j].nx = nx / l; sp[j].ny = ny / l;
    }
    for (const p of sp) puff(S, p.x, p.y, R * (0.1 + 0.5 * p.s), A * p.a * 0.12);
    for (let j = 1; j <= N; j++) {
      const P0 = sp[j - 1], P1 = sp[j], a1 = A * P1.a;
      if (a1 < 0.004) continue;
      const w0 = R * (0.025 + 0.22 * Math.pow(P0.s, 1.1)) * (0.1 + 0.9 * P0.face), w1 = R * (0.025 + 0.22 * Math.pow(P1.s, 1.1)) * (0.1 + 0.9 * P1.face);
      F.globalAlpha = Math.min(1, (a1 * 0.1) / (0.3 + P1.face));
      F.beginPath(); F.moveTo(P0.x + P0.nx * w0, P0.y + P0.ny * w0); F.lineTo(P1.x + P1.nx * w1, P1.y + P1.ny * w1);
      F.lineTo(P1.x - P1.nx * w1, P1.y - P1.ny * w1); F.lineTo(P0.x - P0.nx * w0, P0.y - P0.ny * w0); F.closePath(); F.fill();
      const th = Math.pow(1 - P1.face, 3) * sstep(0.04, 0.3, P1.s);
      if (th > 0.02) {
        F.globalAlpha = Math.min(1, a1 * 0.55 * th); F.lineWidth = u * sc * (1.1 + 1.6 * P1.s);
        F.beginPath(); F.moveTo(P0.x, P0.y); F.lineTo(P1.x, P1.y); F.stroke();
      }
    }
  }
}

/* =====================================================================================================
   SCREENS: a ribbon of steam rises, meets its screen and splits in two to draw the outline; the screen
   develops a tiny living world; later the outline is reeled back in, down a spiral, into the cup.
   ===================================================================================================== */
function screenGeom(L, i, t) {        // screens float gently while they are on
  const s = L.scr[i], hh = s.s, u = L.u;
  return outline(s.x + 3 * u * Math.cos(om(1) * t + i * 2.1), s.y + 6 * u * Math.sin(om(1) * t + i * 2.1 + 0.8), hh * RATIO[i], hh);
}
function ribbonGeom(G, cup, i, L) {
  // attach point: the side of the screen that faces the rising steam, fixed by the layout (not by the moving camera)
  const s = L.scr[i], G0 = outline(s.x, s.y, s.s * RATIO[i], s.s), bc = L.cup;
  const s0 = G0.closest(bc.x + bc.s * [0, -0.3, 0.3][i], bc.y + 0.06 * bc.s - [2.5, 2.0, 2.0][i] * bc.s), P = G.at(s0);
  const O = [cup.x + cup.R * [0, -0.3, 0.3][i], cup.sy - 0.04 * cup.R];
  const d = Math.hypot(P[0] - O[0], P[1] - O[1]), wob = [0.22, -0.18, 0.2][i] * d;
  // rise first, then arc over like a fountain and land on the screen from outside
  const C1 = [O[0] + wob * 0.4, O[1] - 0.8 * d], C2 = [P[0] + P[2] * 0.45 * d - wob * 0.3, P[1] + P[3] * 0.45 * d - (i ? 0.25 * d : 0)];
  const pts = []; for (let j = 0; j <= 48; j++) pts.push(bez(O, C1, C2, [P[0], P[1]], j / 48));
  return { O, P: [P[0], P[1]], n: [P[2], P[3]], s0, d, up: arcPath(pts) };
}
function returnGeom(RB, cup, i) {   // attach point -> arc -> helix winding down into the cup
  const R = cup.R, e = cup.e, th0 = -Math.PI / 2 + [0, -0.95, 0.95][i], rE = 0.82 * R, zE = 1.55 * R, turns = 1.2;
  const hel = f => {
    const th = th0 + f * turns * TAU, r = rE * Math.pow(1 - f, 0.85) + 0.07 * R * f, z = zE * Math.pow(1 - f, 1.3);
    return [cup.x + r * Math.cos(th), cup.sy - z + r * e * Math.sin(th)];
  };
  const E = hel(0), E2 = hel(0.01), tx = E2[0] - E[0], ty = E2[1] - E[1], tl = Math.hypot(tx, ty) || 1;
  const P = RB.P, d = Math.hypot(E[0] - P[0], E[1] - P[1]);
  const C1 = [P[0] + RB.n[0] * 0.5 * d, P[1] + RB.n[1] * 0.5 * d - 0.1 * d], C2 = [E[0] - (tx / tl) * 0.5 * d, E[1] - (ty / tl) * 0.5 * d];
  const pts = [];
  for (let j = 0; j <= 40; j++) pts.push(bez(P, C1, C2, E, j / 40));
  for (let j = 1; j <= 72; j++) pts.push(hel(j / 72));
  return arcPath(pts);
}
function screenState(i, t) {
  const ts = TL.rib[i], t1 = ts + TL.rise, t2 = t1 + TL.trace, tu = TL.unravel[i], p0 = tu + 0.12;
  return {
    ts, t1, t2, tu, p0,
    qc: t < ts ? 0 : sine(inv(ts, t1, t)),
    qo: ease(inv(t1, t2, t)),
    life: 1 - inv(t1, t1 + 0.9, t),
    dev: easeOut(inv(t2 - 0.15, t2 + TL.dev, t)),
    fade: ease(inv(tu, tu + 0.36, t)),
    pull: ease(inv(p0, p0 + TL.pullIn, t)),
  };
}
/* a luminous steam rope along a path section [la, lb]: filaments + volume on the layers, a crisp core on top */
function rope(S, F, core, path, la, lb, u, t, o) {
  const len = lb - la; if (len <= 0.5) return;
  const n = Math.max(2, Math.ceil(len / (5 * u)));
  let prev = null;
  for (let j = 0; j <= n; j++) {
    const l = la + (len * j) / n, p = path.at(l), f = j / n;            // f: 0 at the tail, 1 at the head
    const nx = -p[3], ny = p[2], a = o.alpha(l, f), wd = (o.w0 + o.w1 * f) * u;
    const o1 = wd * (0.65 * Math.sin(l / (38 * u) - om(5) * t + 1.3) + 0.35 * Math.sin(l / (15 * u) + om(9) * t + 2.1));
    const o2 = wd * (0.6 * Math.sin(l / (29 * u) + om(6) * t + 4.1) + 0.4 * Math.sin(l / (11 * u) - om(11) * t + 0.4));
    const pts = [[p[0], p[1]], [p[0] + nx * o1, p[1] + ny * o1], [p[0] + nx * o2, p[1] + ny * o2]];
    if (j % 2 === 0) puff(S, p[0], p[1], (o.puff + 10 * f) * u, a * o.pa);
    if (prev) {
      F.globalAlpha = Math.min(1, a * o.fa * 0.35); F.lineWidth = (5 + 3 * f) * u;              // glow
      F.beginPath(); F.moveTo(prev[0][0], prev[0][1]); F.lineTo(pts[0][0], pts[0][1]); F.stroke();
      F.globalAlpha = Math.min(1, a * o.fa * 0.55); F.lineWidth = (1.1 + 0.8 * f) * u;           // wisps
      F.beginPath(); F.moveTo(prev[1][0], prev[1][1]); F.lineTo(pts[1][0], pts[1][1]);
      F.moveTo(prev[2][0], prev[2][1]); F.lineTo(pts[2][0], pts[2][1]); F.stroke();
    }
    prev = pts;
  }
  if (core) core.push([path, la, lb, o.core]);
}

function drawScreenWorld(ctx, i, G, t, pal, u, st, cupTableY, L_h) {
  const a = st.dev * (1 - st.fade);
  if (a <= 0.002) return;
  const ty = cupTableY, gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);   // warm pool on the table under the screen
  gl.addColorStop(0, rgba(pal.light, 0.16 * a)); gl.addColorStop(1, rgba(pal.light, 0));
  ctx.save(); ctx.translate(G.cx, ty + 0.35 * (L_h - ty)); ctx.scale(G.w * 0.75, 0.12 * (L_h - ty) + 0.08 * G.w);
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
  ctx.save();                                   // light spill from the screen onto the wall
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.34 * a;
  ctx.drawImage(tinted(pal.light), G.cx - 0.5 * G.w - 90 * u, G.cy - 0.5 * G.h - 90 * u, G.w + 180 * u, G.h + 180 * u);
  ctx.restore();
  const Lc = layer('scr' + i, G.w + 2, G.h + 2), c = Lc.x;
  const zoom = 1 + 0.06 * (1 - st.dev);
  c.translate(1 + G.w / 2, 1 + G.h / 2); c.scale(zoom, zoom); c.translate(-G.w / 2, -G.h / 2);
  world(c, 0, 0, G.w, G.h, t - 2.2, pal);
  c.setTransform(1, 0, 0, 1, 1, 1);
  chrome(c, i, 0, 0, G.w, G.h, t - 2.2, pal, u);
  const fl = 4 * st.dev * (1 - st.dev);
  if (fl > 0.01) { c.globalAlpha = 0.3 * fl; c.fillStyle = rgba(pal.light, 1); c.fillRect(0, 0, G.w, G.h); c.globalAlpha = 1; }
  const g = c.createRadialGradient(G.w / 2, G.h / 2, 0.3 * Math.max(G.w, G.h), G.w / 2, G.h / 2, 0.75 * Math.max(G.w, G.h));
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.36)');
  c.fillStyle = g; c.fillRect(0, 0, G.w, G.h);
  ctx.save(); rr(ctx, G.l, G.tp, G.w, G.h, G.r); ctx.clip();
  ctx.globalAlpha = a; ctx.drawImage(Lc.c, 0, 0, Lc.w, Lc.h, G.l - 1, G.tp - 1, Lc.w, Lc.h);
  ctx.restore();
}

/* tiny living world: golden-hour valley, sun, hot-air balloon, birds. It re-lays per screen shape too. */
const WORLD = {
  wide:   { hz: 0.64, sun: [0.7, 0.5, 0.13], bal: [0.27, 0.42, 0.25], birds: [0.5, 0.26] },
  square: { hz: 0.66, sun: [0.6, 0.52, 0.17], bal: [0.32, 0.38, 0.28], birds: [0.62, 0.22] },
  tall:   { hz: 0.72, sun: [0.58, 0.6, 0.22], bal: [0.42, 0.33, 0.46], birds: [0.64, 0.17] },
};
function worldLayout(ar) {
  const la = Math.log(ar), A = WORLD.square, B = la >= 0 ? WORLD.wide : WORLD.tall, k = clamp(Math.abs(la) / K169);
  const m = (a, b) => (Array.isArray(a) ? a.map((v, j) => lerp(v, b[j], k)) : lerp(a, b, k));
  return { hz: m(A.hz, B.hz), sun: m(A.sun, B.sun), bal: m(A.bal, B.bal), birds: m(A.birds, B.birds) };
}
function ridgeF(x, sd) {
  return (Math.sin(TAU * 0.9 * x + sd * 1.7) + 0.5 * Math.sin(TAU * 2.3 * x + sd * 3.1) + 0.24 * Math.sin(TAU * 5.1 * x + sd * 0.7)
    + 0.1 * Math.sin(TAU * 11.3 * x + sd * 2.3)) / 1.84;
}
const RIDGES = [
  { b: 0.1, a: 0.055, top: '#E09A63', bot: '#A9643C', pan: 0.004, sd: 1 },
  { b: 0.045, a: 0.05, top: '#A55A32', bot: '#5E2C16', pan: 0.01, sd: 2 },
  { b: -0.03, a: 0.04, top: '#5A2C16', bot: '#2A130A', pan: 0.02, sd: 3 },
  { b: -0.16, a: 0.035, top: '#241109', bot: '#110804', pan: 0.034, sd: 4 },
];
function world(c, X, Y, W, H, tau, pal) {
  const wl = worldLayout(W / H), m = Math.min(W, H), hz = Y + wl.hz * H;
  let g = c.createLinearGradient(0, Y, 0, hz);
  g.addColorStop(0, '#1C110D'); g.addColorStop(0.4, '#4A2518'); g.addColorStop(0.78, '#B25F39'); g.addColorStop(1, '#F0A868');
  c.fillStyle = g; c.fillRect(X, Y, W, hz - Y + 2);
  c.fillStyle = '#2B150C'; c.fillRect(X, hz, W, Y + H - hz);
  const sx = X + wl.sun[0] * W, sy = Y + wl.sun[1] * H + tau * 0.01 * H, sr = wl.sun[2] * m;
  g = c.createRadialGradient(sx, sy, 0, sx, sy, sr * 5.5);
  g.addColorStop(0, 'rgba(255,220,160,0.85)'); g.addColorStop(0.18, 'rgba(255,176,104,0.42)'); g.addColorStop(1, 'rgba(255,140,80,0)');
  c.fillStyle = g; c.fillRect(X, Y, W, H);
  c.save(); c.globalCompositeOperation = 'screen';          // slow sun rays
  for (let j = 0; j < 7; j++) {
    const an = (j / 7) * TAU + tau * 0.05 + 0.3, sp = 0.09;
    c.fillStyle = `rgba(255,190,120,${(0.05 + 0.03 * Math.sin(tau * 1.3 + j * 1.7)).toFixed(3)})`;
    c.beginPath(); c.moveTo(sx, sy); c.arc(sx, sy, sr * 9, an - sp, an + sp); c.closePath(); c.fill();
  }
  c.restore();
  c.fillStyle = '#FFEBC6'; c.beginPath(); c.arc(sx, sy, sr, 0, TAU); c.fill();
  for (let j = 0; j < 4; j++) {                             // thin high clouds
    const cxp = X + ((0.12 + 0.27 * j + 0.012 * tau * (1 + j * 0.3)) % 1.1) * W, cyp = Y + (0.14 + 0.07 * j) * H * (wl.hz / 0.66);
    c.globalAlpha = 0.2 - 0.025 * j; c.drawImage(PUFF, cxp - 0.28 * m, cyp - 0.02 * m, 0.56 * m, 0.04 * m);
  }
  c.globalAlpha = 1;
  RIDGES.forEach((r, j) => {
    c.beginPath(); c.moveTo(X, Y + H + 2);
    const n = 72; let yMin = Infinity;
    for (let q = 0; q <= n; q++) {
      const fx = q / n, xx = (fx * W) / m + r.pan * tau + r.sd * 3.1, yy = hz - (r.b + r.a * ridgeF(xx, r.sd)) * m;
      yMin = Math.min(yMin, yy); c.lineTo(X + fx * W, yy);
    }
    c.lineTo(X + W, Y + H + 2); c.closePath();
    g = c.createLinearGradient(0, yMin, 0, yMin + (0.2 + 0.05 * j) * m);
    g.addColorStop(0, r.top); g.addColorStop(1, r.bot);
    c.fillStyle = g; c.fill();
    if (j < 2) {
      g = c.createLinearGradient(0, hz - 0.07 * m, 0, hz + 0.05 * m);
      g.addColorStop(0, 'rgba(255,200,150,0)'); g.addColorStop(0.6, `rgba(255,196,140,${j ? 0.18 : 0.26})`); g.addColorStop(1, 'rgba(255,200,150,0)');
      c.fillStyle = g; c.fillRect(X, hz - 0.07 * m, W, 0.12 * m);
    }
  });
  const bs = wl.bal[2] * m, bx = X + wl.bal[0] * W + tau * 0.005 * W, by = Y + wl.bal[1] * H - tau * 0.016 * H + Math.sin(tau * 1.4) * 0.004 * H;
  balloon(c, bx, by, bs, pal);
  for (let b = 0; b < 3; b++) {
    const s = m * (0.024 - 0.004 * b), px = X + (wl.birds[0] + 0.07 * b - 0.03 * b * b + tau * 0.028) * W, py = Y + (wl.birds[1] + 0.035 * b + 0.01 * Math.sin(tau * 2 + b)) * H;
    const fl = Math.sin(tau * TAU * 1.6 + b * 1.9);
    c.strokeStyle = 'rgba(28,14,9,0.85)'; c.lineWidth = Math.max(0.8, s * 0.16); c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(px - s, py - fl * 0.45 * s); c.quadraticCurveTo(px - 0.45 * s, py - 0.35 * s - fl * 0.1 * s, px, py);
    c.quadraticCurveTo(px + 0.45 * s, py - 0.35 * s - fl * 0.1 * s, px + s, py - fl * 0.45 * s); c.stroke();
  }
}
function balloon(c, bx, by, s, pal) {
  const yc = by - 0.1 * s, ryU = 0.46 * s, rx = 0.5 * s, yT = by + 0.44 * s;
  const hw = y => (y <= yc ? rx * Math.sqrt(clamp(1 - ((y - yc) / ryU) ** 2)) : rx * (1 - 0.7 * Math.pow(clamp((y - yc) / (yT - yc)), 1.5)));
  const top = yc - ryU, n = 40, env = new Path2D();
  for (let j = 0; j <= n; j++) { const y = top + ((yT - top) * j) / n; j ? env.lineTo(bx + hw(y), y) : env.moveTo(bx + hw(y), y); }
  for (let j = n; j >= 0; j--) { const y = top + ((yT - top) * j) / n; env.lineTo(bx - hw(y), y); }
  env.closePath();
  c.strokeStyle = 'rgba(40,20,10,0.9)'; c.lineWidth = Math.max(0.6, 0.012 * s);
  const bw = 0.17 * s, bt = by + 0.62 * s;
  c.beginPath(); c.moveTo(bx - 0.14 * s, yT); c.lineTo(bx - bw / 2, bt); c.moveTo(bx + 0.14 * s, yT); c.lineTo(bx + bw / 2, bt); c.stroke();
  c.fillStyle = '#2A150B'; rr(c, bx - bw / 2, bt, bw, 0.12 * s, 0.02 * s); c.fill();
  c.save(); c.clip(env);
  const cols = ['#F3E4C8', rgba(pal.accent, 1)];
  for (let k = -4; k < 4; k++) {
    const t0 = (k / 4) * (Math.PI / 2), t1 = ((k + 1) / 4) * (Math.PI / 2);
    c.beginPath();
    for (let j = 0; j <= n; j++) { const y = top + ((yT - top) * j) / n, x = bx + hw(y) * Math.sin(t0); j ? c.lineTo(x, y) : c.moveTo(x, y); }
    for (let j = n; j >= 0; j--) { const y = top + ((yT - top) * j) / n; c.lineTo(bx + hw(y) * Math.sin(t1), y); }
    c.closePath(); c.fillStyle = cols[(k + 8) % 2]; c.fill();
  }
  const g = c.createRadialGradient(bx - 0.2 * s, yc - 0.2 * s, 0.05 * s, bx, yc, 0.75 * s);
  g.addColorStop(0, 'rgba(255,245,225,0.35)'); g.addColorStop(0.55, 'rgba(60,25,10,0.05)'); g.addColorStop(1, 'rgba(40,15,5,0.6)');
  c.fillStyle = g; c.fillRect(bx - s, top - s, 2 * s, 3 * s);
  c.restore();
}
function chrome(c, kind, X, Y, W, H, tau, pal, u) {
  const m = Math.min(W, H);
  if (kind === 0) {           // YouTube 16:9: scrub bar
    let g = c.createLinearGradient(0, Y + 0.72 * H, 0, Y + H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g; c.fillRect(X, Y + 0.72 * H, W, 0.28 * H);
    const x0 = X + 0.035 * W, x1 = X + 0.965 * W, y = Y + H - 0.07 * H, th = Math.max(1.5, 0.009 * H), p = clamp(0.14 + 0.1 * Math.max(0, tau));
    c.fillStyle = 'rgba(255,240,222,0.3)'; rr(c, x0, y - th / 2, x1 - x0, th, th / 2); c.fill();
    c.fillStyle = rgba(pal.accent, 1); rr(c, x0, y - th / 2, (x1 - x0) * p, th, th / 2); c.fill();
    c.beginPath(); c.arc(x0 + (x1 - x0) * p, y, th * 2, 0, TAU); c.fill();
  } else if (kind === 1) {    // vertical story: progress segments + rising hearts
    let g = c.createLinearGradient(0, Y, 0, Y + 0.14 * H);
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(X, Y, W, 0.14 * H);
    const gap = 0.02 * W, sw = (W * 0.9 - 2 * gap) / 3, th = Math.max(1.5, 0.005 * H), yy = Y + 0.028 * H;
    for (let j = 0; j < 3; j++) {
      const x = X + 0.05 * W + j * (sw + gap);
      c.fillStyle = 'rgba(255,240,222,0.3)'; rr(c, x, yy, sw, th, th / 2); c.fill();
      const f = j === 0 ? 1 : j === 1 ? clamp(tau / 4.2) : 0;
      if (f > 0) { c.fillStyle = 'rgba(255,244,230,0.95)'; rr(c, x, yy, sw * f, th, th / 2); c.fill(); }
    }
    for (let j = 0; j < 12; j++) {
      const a = tau - (0.35 + j * 0.32);
      if (a < 0 || a > 1.9) continue;
      const k = a / 1.9, s = m * (0.085 + 0.03 * hash(j + 40)) * (0.6 + 0.4 * easeOut(clamp(a * 4)));
      const hx = X + W * (0.83 + 0.05 * Math.sin(a * 3.2 + j)), hy = Y + H * (0.9 - 0.36 * easeOut(k));
      c.globalAlpha = (1 - k) * clamp(a * 6);
      c.fillStyle = j % 3 === 1 ? 'rgba(255,244,230,1)' : rgba(pal.accent, 1);
      heart(c, hx, hy, s); c.fill();
    }
    c.globalAlpha = 1;
  } else {                    // X 1:1: like + count
    let g = c.createLinearGradient(0, Y + 0.7 * H, 0, Y + H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = g; c.fillRect(X, Y + 0.7 * H, W, 0.3 * H);
    const pop = inv(1.2, 1.45, tau), s = m * 0.1 * (1 + 0.35 * Math.sin(Math.PI * pop)), hx = X + 0.1 * W, hy = Y + H - 0.1 * H;
    heart(c, hx, hy, s);
    if (tau > 1.2) { c.fillStyle = rgba(pal.accent, 1); c.fill(); }
    else { c.strokeStyle = 'rgba(255,244,230,0.9)'; c.lineWidth = Math.max(1, 0.012 * m); c.stroke(); }
    const burst = inv(1.2, 1.8, tau);
    if (burst > 0 && burst < 1) {
      c.fillStyle = rgba(pal.accent, 1 - burst);
      for (let j = 0; j < 8; j++) { const an = (j / 8) * TAU, r = s * (0.5 + 0.7 * easeOut(burst)); c.beginPath(); c.arc(hx + Math.cos(an) * r, hy + Math.sin(an) * r, s * 0.05, 0, TAU); c.fill(); }
    }
    const n = 2380 + Math.floor(Math.max(0, tau) * 41) + (tau > 1.2 ? 1 : 0);
    c.font = `600 ${(m * 0.075).toFixed(2)}px Inter`; c.fillStyle = 'rgba(255,244,230,0.92)'; c.textBaseline = 'middle';
    c.fillText(n.toLocaleString('en-US'), hx + s * 0.8, hy + s * 0.02);
  }
}

/* ---------- labels: real platform logos + the aspect ratio ---------- */
function drawLabel(ctx, i, G, a, u) {
  if (a <= 0.003) return;
  const lh = 30 * u, y = G.tp - 18 * u - lh;
  ctx.save(); ctx.globalAlpha = a;
  let x = G.l + 2 * u;
  for (const n of [['youtube'], ['instagram', 'tiktok'], ['x']][i]) { const hh = n === 'x' ? lh * 0.84 : lh; x += drawLogo(ctx, n, x, y + (lh - hh) / 2, hh) + 11 * u; }
  ctx.font = `600 ${(21 * u).toFixed(2)}px Inter`; ctx.letterSpacing = `${(1.4 * u).toFixed(2)}px`;
  ctx.fillStyle = rgba(CREAM, 0.74); ctx.textBaseline = 'middle';
  ctx.fillText(['16:9', '9:16', '1:1'][i], x + 5 * u, y + lh / 2 + 1 * u);
  ctx.letterSpacing = '0px';
  ctx.restore();
}

/* ---------- end card ---------- */
function endCard(ctx, t, L, pal) {
  const [a0, , b0, b1] = TL.text;
  if (t < a0 || t > b1) return;
  const lines = [[['With ', 0], ['enough ', 0], [pal.word, 1], [',', 0]], [['anything ', 0], ['is ', 0], ['possible.', 0]]];
  const widths = lines.map(ln => ln.reduce((s, [str, it]) => s + measure(ctx, str, it), 0));
  const size = Math.min(L.endSize, (0.84 * L.w) / (Math.max(...widths) / OPSZ)), k = size / OPSZ, lh = size * 1.2;
  const out = ease(inv(b0, b1, t));
  lines.forEach((ln, li) => {
    let x = L.w / 2 - (widths[li] * k) / 2;
    const y = L.endY + (li - 0.5) * lh + size * 0.33;
    const aj = easeOut(inv(a0 + 0.2 * li, a0 + 0.2 * li + 0.6, t)), al = aj * (1 - out);   // whole lines: never a lone word
    ln.forEach(([str, it]) => {
      if (al > 0.003) {
        ctx.save();
        ctx.translate(x, y + (1 - aj) * 0.2 * size - out * 0.22 * size); ctx.scale(k, k);
        ctx.font = fontStr(it); ctx.textBaseline = 'alphabetic';
        const bl = (1 - aj) * 6 + out * 4;
        if (bl > 0.05) ctx.filter = `blur(${(bl * (size / 80)).toFixed(2)}px)`;
        ctx.globalAlpha = al; ctx.fillStyle = it ? rgba(pal.accent, 1) : rgba(CREAM, 1);
        ctx.fillText(str, 0, 0);
        ctx.restore();
      }
      x += measure(ctx, str, it) * k;
    });
  });
}

/* =====================================================================================================
   RENDER: frame t (seconds, any value; wraps at 10) into a w x h context
   ===================================================================================================== */
function render(ctx, t, w, h, opts = {}) {
  t = ((t % DUR) + DUR) % DUR;
  const drink = (opts.drink || DRINK) === 'tea' ? 'tea' : 'coffee', pal = PAL[drink];
  const L = layout(w, h), u = L.u, cup = cupAt(L, t, drink);
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  drawRoom(ctx, w, h, L, cup, pal, t);
  drawCup(ctx, cup, pal, t);

  const ks = 0.25, kf = 0.5;
  const SL = layer('soft', w * ks, h * ks), FL = layer('fil', w * kf, h * kf), S = SL.x, F = FL.x;
  S.setTransform(ks, 0, 0, ks, 0, 0); F.setTransform(kf, 0, 0, kf, 0, 0);
  F.lineCap = 'round'; F.lineJoin = 'round'; F.strokeStyle = '#fff'; F.fillStyle = '#fff';
  const tall = clamp(-Math.log(w / h) / K169);                        // portrait frames get a taller plume
  ambientSteam(S, F, cup, t, lerp(1, 0.6, cup.k), u, lerp(1 + 0.4 * tall, 0.62, cup.k));

  const outlines = [], cores = [], heads = [];
  for (let i = 0; i < 3; i++) {
    const st = screenState(i, t);
    if (t < st.ts || st.pull >= 1) continue;
    const G = screenGeom(L, i, t), RB = ribbonGeom(G, cup, i, L), half = G.P / 2;
    drawScreenWorld(ctx, i, G, t, pal, u, st, cup.y - 0.12 * cup.R, h);
    // up: a thread of steam rises from the cup to the screen, then evaporates
    if (st.life > 0 && st.qc > 0) {
      const lh = st.qc * RB.up.L, life = st.life;
      rope(S, F, life > 0.02 ? cores : null, RB.up, 0, lh, u, t, {
        w0: 2, w1: 3 + 8 * (1 - life), puff: 9 + 14 * (1 - life), pa: 0.2, fa: 0.8,
        alpha: (l, f) => life * inv(0, 0.12, l / RB.up.L) * (0.35 + 0.65 * Math.pow(f, 1.4)),
        core: { a: 0.85 * life * life, fade: true },
      });
      if (st.qc < 1) { const p = RB.up.at(lh); heads.push([p[0], p[1], 1]); }
    }
    // the outline: grows both ways from the attach point; reeled back in at the end
    const RP = st.pull > 0 ? returnGeom(RB, cup, i) : null;
    const pulled = RP ? st.pull * (half + RP.L) : 0;
    const d = Math.min(st.qo, Math.max(0, 1 - pulled / half));
    if (d > 0.001) {
      outlines.push([G, RB.s0 - d * half, RB.s0 + d * half, RB.s0, half, st]);
      const post = Math.exp(-Math.max(0, t - st.t2) / 0.3);
      if (post > 0.02) for (let j = 0; j <= 90; j++) {            // fresh line: steam condensing into it
        const f = j / 90, age = st.qo - Math.abs(f * 2 - 1) * d, hz = Math.exp(-Math.max(0, age) / 0.16) * post;
        if (hz < 0.01) continue;
        const p = G.at(RB.s0 + (f * 2 - 1) * d * half);
        puff(S, p[0] + p[2] * 4 * u, p[1] + p[3] * 4 * u - (1 - hz) * 14 * u, (14 + 10 * (1 - hz)) * u, 0.32 * hz);
      }
      if (st.qo > 0 && st.qo < 1) { const pa = G.at(RB.s0 - st.qo * half), pb = G.at(RB.s0 + st.qo * half); heads.push([pa[0], pa[1], 1], [pb[0], pb[1], 1]); }
      if (st.qo >= 1 && t < st.t2 + 0.5) { const pf = G.at(RB.s0 + half); heads.push([pf[0], pf[1], 1 - inv(st.t2, st.t2 + 0.5, t)]); }
      if (RP && d < 1) { const pa = G.at(RB.s0 - d * half), pb = G.at(RB.s0 + d * half); heads.push([pa[0], pa[1], 0.8], [pb[0], pb[1], 0.8]); }
    }
    drawLabel(ctx, i, G, easeOut(inv(st.t2 + 0.05, st.t2 + 0.5, t)) * (1 - st.fade), u);
    // down: the reeled-in line becomes a two-ply steam rope that winds down into the cup
    if (RP && pulled > 0) {
      const lb = Math.min(RP.L, pulled), la = Math.max(0, pulled - half);
      const tp = la > 0 ? 70 * u : 0;           // once the outline is all reeled in, the free tail tapers off
      rope(S, F, cores, RP, la, lb, u, t, {
        w0: 3, w1: 5, puff: 10, pa: 0.2, fa: 0.85,
        alpha: (l, f) => (1 - inv(0.82 * RP.L, RP.L, l)) * (0.55 + 0.45 * f) * (tp ? sstep(0, tp, l - la) : 1),
        core: { a: 0.9, fade: true, end: RP.L, taper: tp },
      });
      if (lb < RP.L) { const p = RP.at(lb); heads.push([p[0], p[1], 0.9 * (1 - inv(0.8 * RP.L, RP.L, lb))]); }
    }
  }
  // composite the steam, tinted warm
  tint(SL, pal.steam); tint(FL, pal.steam);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(SL.c, 0, 0, SL.w, SL.h, 0, 0, w, h); ctx.drawImage(FL.c, 0, 0, FL.w, FL.h, 0, 0, w, h);
  ctx.restore();

  // crisp lines: screen outlines, then rope cores (fading towards their heads)
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [G, sa, sb, s0, half, st] of outlines) {
    // freshly drawn line: still wavy steam that settles into a crisp line (~0.3 s)
    const n = Math.max(2, Math.ceil(((sb - sa) / G.P) * 420));
    ctx.beginPath();
    for (let j = 0; j <= n; j++) {
      const sP = sa + ((sb - sa) * j) / n, p = G.at(sP), dist = Math.abs(sP - s0) / half;
      const age = Math.max(0, (st.qo - dist) * TL.trace) + Math.max(0, t - st.t2);
      const wob = 6 * u * Math.exp(-age / 0.14) * Math.sin(sP / (21 * u) - om(15) * t);
      const x = p[0] + p[2] * wob, y = p[1] + p[3] * wob;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(pal.light, 0.16); ctx.lineWidth = 7 * u; ctx.stroke();
    ctx.strokeStyle = rgba(LINE, 0.92); ctx.lineWidth = 1.9 * u; ctx.stroke();
  }
  for (const [path, la, lb, o] of cores) {
    const n = Math.max(2, Math.ceil((lb - la) / (6 * u)));
    for (let j = 1; j <= n; j++) {
      const l0 = la + ((lb - la) * (j - 1)) / n, l1 = la + ((lb - la) * j) / n, p0 = path.at(l0), p1 = path.at(l1);
      const f = j / n, end = o.end ? 1 - inv(0.72 * o.end, 0.95 * o.end, l1) : 1, tap = o.taper ? sstep(0, o.taper, l0 - la) : 1;
      const a = o.a * end * tap * (o.fade ? Math.pow(1 - f, 0.8) * 0.75 + 0.25 * (1 - f) : 1);
      if (a < 0.01) continue;
      ctx.strokeStyle = rgba(LINE, a); ctx.lineWidth = 1.7 * u;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
  }
  ctx.restore();
  for (const [x, y, a] of heads) {
    if (a <= 0.01) continue;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(x, y, 0, x, y, 28 * u);
    g.addColorStop(0, rgba([255, 248, 236], 0.95 * a)); g.addColorStop(0.18, rgba(pal.accent, 0.55 * a)); g.addColorStop(1, rgba(pal.accent, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 28 * u, 0, TAU); ctx.fill();
    ctx.restore();
  }

  endCard(ctx, t, L, pal);

  // film grain + vignette
  const fr = ((Math.round(t * 30) % 300) + 300) % 300, pat = ctx.createPattern(grainTile(fr % 3), 'repeat'), gs = Math.max(1, u * 1.15);
  pat.setTransform(new DOMMatrix([gs, 0, 0, gs, -Math.round(h2(fr, 3) * 256) * gs, -Math.round(h2(fr, 4) * 256) * gs]));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.2; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.028; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const D = Math.hypot(w, h), vg = ctx.createRadialGradient(w / 2, h * 0.5, 0.22 * D, w / 2, h * 0.5, 0.7 * D);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* =====================================================================================================
   STAGE: the scene in a frame of any aspect, centred on a softly lit surround (player + flip export)
   ===================================================================================================== */
function renderStage(ctx, t, W, H, o = {}) {
  const aspect = o.aspect || 16 / 9, chips = !!o.chips, m = Math.min(W, H);
  const padT = chips ? 0.045 * H : 0.035 * m, padB = chips ? 0.125 * H : 0.035 * m, padX = 0.035 * m;
  const aw = W - 2 * padX, ah = H - padT - padB;
  const fw = Math.round(Math.min(aw, ah * aspect)), fh = Math.round(fw / aspect);
  const fx = Math.round((W - fw) / 2), fy = Math.round(padT + (ah - fh) / 2);
  const Fr = layer('frame', fw, fh);
  render(Fr.x, t, fw, fh, o);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = '#070504'; ctx.fillRect(0, 0, W, H);
  const tw = 32, th = Math.max(1, Math.round(32 / aspect)), T1 = layer('tiny', tw, th);
  T1.x.imageSmoothingQuality = 'high'; T1.x.drawImage(Fr.c, 0, 0, fw, fh, 0, 0, tw, th);
  const mw = 160, mh = Math.max(1, Math.round((160 * H) / W)), T2 = layer('mid', mw, mh), cs = Math.max(mw / tw, mh / th) * 1.1;
  T2.x.filter = 'blur(6px)'; T2.x.drawImage(T1.c, 0, 0, tw, th, (mw - tw * cs) / 2, (mh - th * cs) / 2, tw * cs, th * cs); T2.x.filter = 'none';
  ctx.globalAlpha = 0.6; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(T2.c, 0, 0, mw, mh, 0, 0, W, H); ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(W / 2, H / 2, 0.2 * Math.max(W, H), W / 2, H / 2, 0.75 * Math.max(W, H));
  g.addColorStop(0, 'rgba(7,5,4,0.2)'); g.addColorStop(1, 'rgba(7,5,4,0.85)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rad = 0.014 * m;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 0.05 * m; ctx.shadowOffsetY = 0.012 * m;
  ctx.fillStyle = '#000'; rr(ctx, fx, fy, fw, fh, rad); ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, fx, fy, fw, fh, rad); ctx.clip(); ctx.drawImage(Fr.c, 0, 0, fw, fh, fx, fy, fw, fh); ctx.restore();
  ctx.strokeStyle = 'rgba(255,236,212,0.12)'; ctx.lineWidth = Math.max(1, 0.0012 * m); rr(ctx, fx + 0.5, fy + 0.5, fw - 1, fh - 1, rad); ctx.stroke();
  if (chips) drawChips(ctx, W, H, o.chipK || 0, PAL[(o.drink || DRINK) === 'tea' ? 'tea' : 'coffee']);
  ctx.restore();
  return { fx, fy, fw, fh };
}
function drawChips(ctx, W, H, k, pal) {
  const labels = ['16:9', '9:16', '1:1'], cw = 0.062 * W, ch = 0.05 * H, gap = 0.006 * W, pad = 0.005 * W;
  const tot = labels.length * cw + (labels.length - 1) * gap + 2 * pad, x0 = (W - tot) / 2, y0 = H - 0.0625 * H - ch / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,240,222,0.05)'; ctx.strokeStyle = 'rgba(255,240,222,0.12)'; ctx.lineWidth = Math.max(1, 0.0012 * H);
  rr(ctx, x0, y0 - pad, tot, ch + 2 * pad, (ch + 2 * pad) / 2); ctx.fill(); ctx.stroke();
  const px = x0 + pad + k * (cw + gap);
  ctx.fillStyle = rgba(pal.accent, 1); rr(ctx, px, y0, cw, ch, ch / 2); ctx.fill();
  ctx.font = `600 ${(0.021 * H).toFixed(1)}px Inter`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  labels.forEach((s, j) => {
    const cx = x0 + pad + j * (cw + gap) + cw / 2, on = 1 - Math.min(1, Math.abs(k - j));
    ctx.fillStyle = on > 0.5 ? `rgba(26,16,10,${0.5 + 0.5 * on})` : `rgba(244,234,219,${0.62 - 0.3 * on})`;
    ctx.fillText(s, cx, y0 + ch / 2 + 0.002 * H);
  });
  ctx.restore();
}
/* the live re-layout moment, scripted: 16:9 -> 9:16 on a 16:9 canvas (5 s). The scene runs at 0.8x from 2.95 s, so the
   clip opens with all three screens alive, re-lays mid-clip and ends as the steam winds home (before the end card). */
function renderFlip(ctx, t, W, H, o = {}) {
  const k = ease(inv(1.25, 2.45, t)), aspect = Math.exp(lerp(Math.log(16 / 9), Math.log(9 / 16), k));
  return renderStage(ctx, 2.95 + 0.8 * t, W, H, Object.assign({}, o, { aspect, chips: true, chipK: ease(inv(0.95, 1.3, t)) }));
}

window.SCENE = { DUR, DRINK, render, renderStage, renderFlip, layout, ready, PAL };
})();
