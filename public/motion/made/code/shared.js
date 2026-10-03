/* Horizon Strike · story loops · shared kit
 *
 *   window.STORY_KIT        palette, easing, time helpers, ground + planet rim, film grain,
 *                           ivory paper, torn ochre / zebra paper, ink lines, type
 *   window.STORY_LOOPS[key] = { dur, render(ctx, t, w, h) }   (level-N.js -> 1..7; loop-proof/levels/finale/firecrawl.js -> names)
 *
 * Every frame is a pure function of t: no Math.random, no state between frames. Caches (grain tiles, paper
 * sprites) are seeded and deterministic, so the same t always paints the same pixels, in any order.
 * All drawing happens in a 1920x1080 design space; render() scales it to any 16:9 canvas and respects a
 * transform the host already set (e.g. a DPR scale with CSS-pixel w, h).
 * Fonts: the host page loads Newsreader (500, opsz axis) and Inter. Serif text is set at 36px and scaled,
 * so Chrome's automatic optical sizing lands on opsz 36 (the Horizon Strike rule) at every size.
 *
 * Deck use (inline in this order: shared.js, level-1.js ... level-7.js, loop-proof.js, loop-levels.js, loop-finale.js, loop-firecrawl.js;
 * the levels and finale loops draw levels 1-7 live, so those files must be present). Keys: 1..7, 'proof', 'levels', 'finale', 'firecrawl'.
 *   await document.fonts.load('500 36px Newsreader'); await document.fonts.load('500 20px Inter');
 *   const L = window.STORY_LOOPS[n], c = canvas, x = c.getContext('2d');
 *   c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio;
 *   rAF: L.render(x, (performance.now() / 1000) % L.dur, c.width, c.height);   // only while the screen is on view
 * Silent: no audio anywhere. Measured 60 fps at 1920x1080 device px on the M4 Max. */
(function () {
  'use strict';
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const K = window.STORY_KIT = {};
  window.STORY_LOOPS = window.STORY_LOOPS || {};
  K.W = W; K.H = H; K.TAU = TAU;
  K.opts = { grain: true };                      // the harness switches grain off for motion-seam analysis

  // ---------- palette (Horizon Strike)
  const C = K.C = {
    night: '#07080C', screen: '#0B0C10', panel: '#0E0F14',
    ivory: '#FAF9F5', paper: '#F1EEE5', moon: '#F4F1EA', ink: '#141413', ink2: '#3D3D3A', ink3: '#8A887F',
    clay: '#D97757', clay2: '#C4603E', peach: '#F2C9B0', ochre: '#E3B23C', dawn: '#FFD7B5', rust: '#B5532F',
  };

  // ---------- math
  const clamp = K.clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = K.lerp = (a, b, u) => a + (b - a) * u;
  K.seg = (t, a, b) => clamp((t - a) / (b - a));
  K.smooth = u => { u = clamp(u); return u * u * (3 - 2 * u); };
  K.wrap = x => x - Math.floor(x);
  K.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u, sy = u => ((ay * u + by) * u + cy) * u;
    const dx = u => (3 * ax * u + 2 * bx) * u + cx;
    return x => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) { const e = sx(u) - x; if (Math.abs(e) < 1e-7) return sy(u); const d = dx(u); if (Math.abs(d) < 1e-6) break; u -= e / d; }
      let lo = 0, hi = 1; u = x;
      for (let i = 0; i < 40; i++) { const v = sx(u); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = u; else hi = u; u = (lo + hi) / 2; }
      return sy(u);
    };
  }
  const E = K.ease = {
    out: bezier(.2, .7, .2, 1),           // the deck's reveal curve
    inOut: bezier(.65, 0, .35, 1),        // travel: slow in, slow out
    soft: bezier(.45, 0, .25, 1),         // gentler in-out for camera moves
    in: bezier(.55, 0, .8, .35),
    sine: u => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u)),
    outBack: (u, s = 1.25) => { u = clamp(u); const c = s + 1; return 1 + c * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2); },
    bezier,
  };
  // envelope: 0 before a, eases up to 1 on [a,b], holds, eases back to 0 on [c,d]
  K.env = (t, a, b, c, d, e = E.inOut) => (t <= a || t >= d) ? 0 : t < b ? e((t - a) / (b - a)) : t <= c ? 1 : 1 - e((t - c) / (d - c));
  // smooth periodic bump centred at phase c (0..1) with half-width hw, wraps around the loop
  K.pbump = (p, c, hw) => { let d = Math.abs(K.wrap(p - c + 0.5) - 0.5) / hw; return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d); };

  // ---------- seeded randomness (never Math.random)
  K.hash = (i, s = 0) => {
    let h = Math.imul((i | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((s | 0) + 0x632BE5AB, 0xC2B2AE35);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  K.rng = seed => { let a = (seed | 0) + 0x6D2B79F5; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const sm = f => f * f * (3 - 2 * f);
  K.noise1 = (x, s = 0) => { const i = Math.floor(x), f = x - i; return lerp(K.hash(i, s), K.hash(i + 1, s), sm(f)) * 2 - 1; };
  // periodic noise: period P (integer lattice cells)
  K.pnoise1 = (x, P, s = 0) => { const i = Math.floor(x), f = x - i, a = ((i % P) + P) % P, b = (a + 1) % P; return lerp(K.hash(a, s), K.hash(b, s), sm(f)) * 2 - 1; };
  K.noise2 = (x, y, s = 0) => {
    const i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
    const h = (a, b) => K.hash(a * 7919 + b * 104729, s);
    return lerp(lerp(h(i, j), h(i + 1, j), fx), lerp(h(i, j + 1), h(i + 1, j + 1), fx), fy) * 2 - 1;
  };
  K.fbm2 = (x, y, s = 0, oct = 4) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += a * K.noise2(x * f, y * f, s + o * 31); a *= 0.5; f *= 2.03; } return v; };

  // ---------- colour
  const rgbCache = {};
  K.rgb = hex => rgbCache[hex] || (rgbCache[hex] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  K.rgba = (hex, a) => { const c = K.rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a)})`; };
  K.mix = (h1, h2, u, a = 1) => { const p = K.rgb(h1), q = K.rgb(h2); return `rgba(${Math.round(lerp(p[0], q[0], u))},${Math.round(lerp(p[1], q[1], u))},${Math.round(lerp(p[2], q[2], u))},${a})`; };
  K.hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

  // ---------- canvas + caches
  const cache = new Map();
  K.cached = (key, make) => { let v = cache.get(key); if (v === undefined) { v = make(); cache.set(key, v); } return v; };
  K.canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const qdev = d => Math.max(0.25, Math.round(d * 4) / 4);   // quantised device scale for cache keys

  // ---------- frame: map the 1920x1080 design space onto any 16:9 canvas
  K.begin = (ctx, w, h) => {
    ctx.save();
    const m = ctx.getTransform(), host = Math.hypot(m.a, m.b) || 1;
    const s = Math.min(w / W, h / H), ox = (w - W * s) / 2, oy = (h - H * s) / 2;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]); ctx.filter = 'none';
    ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (ox > 0.5 || oy > 0.5) { ctx.fillStyle = C.night; ctx.fillRect(0, 0, w, h); }
    ctx.translate(ox, oy); ctx.scale(s, s);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    return { s, dev: s * host, q: qdev(s * host) };
  };
  K.end = ctx => ctx.restore();

  // ---------- ground: night field, soft cinematic light pool, dawn planet rim at the foot
  K.ground = (ctx, p, o = {}) => {
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, W, H);
    const lx = o.lx ?? 960, ly = o.ly ?? 430;
    let g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 1180);
    g.addColorStop(0, 'rgba(226,218,204,0.085)'); g.addColorStop(0.42, 'rgba(226,218,204,0.036)'); g.addColorStop(1, 'rgba(226,218,204,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (o.planet !== false) K.planet(ctx, p, o);
  };

  // planet: circle R = 1.5 x width, apex near the foot; light follows the curve, brightest at the apex
  K.planet = (ctx, p, o = {}) => {
    const R = 2880, ax = 960, ay = o.apex ?? 1028, cy = ay + R, glow = (o.rim ?? 1) * (0.92 + 0.08 * Math.cos(TAU * p));
    ctx.save();
    // haze above the rim (clipped to the sky outside the planet)
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(ax, cy, R, 0, TAU, true); ctx.clip();
    ctx.save(); ctx.translate(ax, ay); ctx.scale(5.2, 1);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, 150);
    g.addColorStop(0, `rgba(240,160,110,${0.20 * glow})`); g.addColorStop(0.35, `rgba(217,119,87,${0.08 * glow})`); g.addColorStop(1, 'rgba(217,119,87,0)');
    ctx.fillStyle = g; ctx.fillRect(-190, -160, 380, 170);
    ctx.restore();
    ctx.restore();
    // body
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, cy, R, 0, TAU); ctx.clip();
    ctx.fillStyle = '#040507'; ctx.fillRect(0, ay - 4, W, H - ay + 8);
    ctx.save(); ctx.translate(ax, ay); ctx.scale(4.4, 1);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 90);
    g.addColorStop(0, `rgba(255,190,140,${0.16 * glow})`); g.addColorStop(0.5, `rgba(160,80,50,${0.05 * glow})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-200, 0, 400, 100);
    ctx.restore();
    ctx.restore();
    // rim line: along the arc, fading away from the apex
    const span = 0.30, lg = ctx.createLinearGradient(ax - 860, 0, ax + 860, 0);
    lg.addColorStop(0, 'rgba(255,215,181,0)'); lg.addColorStop(0.3, `rgba(255,205,165,${0.28 * glow})`);
    lg.addColorStop(0.5, `rgba(255,228,204,${0.95 * glow})`); lg.addColorStop(0.7, `rgba(255,205,165,${0.28 * glow})`); lg.addColorStop(1, 'rgba(255,215,181,0)');
    ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(ax, cy, R, -Math.PI / 2 - span, -Math.PI / 2 + span); ctx.stroke();
    // hot core at the apex, riding the curve
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(ax, ay); ctx.scale(9, 1);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    g.addColorStop(0, `rgba(255,214,180,${0.34 * glow})`); g.addColorStop(1, 'rgba(255,214,180,0)');
    ctx.fillStyle = g; ctx.fillRect(-34, -34, 68, 68);
    ctx.restore();
  };

  // ---------- vignette + film grain (animated at 12 fps, index wraps with the loop)
  K.vignette = (ctx, a = 1) => {
    const g = ctx.createRadialGradient(960, 500, 420, 960, 500, 1260);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.62 * a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  function grainTile(size, seed) {
    const cv = K.canvas(size, size), x = cv.getContext('2d'), im = x.createImageData(size, size), d = im.data, r = K.rng(seed);
    for (let i = 0; i < size * size; i++) {
      // approx gaussian from 3 uniforms
      const v = (r() + r() + r() - 1.5) * 1.15;
      const a = Math.min(0.30, Math.abs(v) * 0.075);
      const c = v > 0 ? 255 : 0;
      d[i * 4] = c; d[i * 4 + 1] = c; d[i * 4 + 2] = c; d[i * 4 + 3] = Math.round(a * 255);
    }
    x.putImageData(im, 0, 0);
    return cv;
  }
  K.grain = (ctx, t, dur, amt = 1) => {
    if (!K.opts.grain || amt <= 0) return;
    const N = Math.max(1, Math.round(dur * 12)), idx = Math.floor(K.wrap(t / dur) * N + 1e-6) % N;
    const T = 320, tile = K.cached('grain', () => grainTile(T, 7));
    const pat = ctx.createPattern(tile, 'repeat');
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.floor(K.hash(idx, 11) * T), Math.floor(K.hash(idx, 23) * T)]));
    ctx.save(); ctx.globalAlpha = amt; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore();
  };
  K.finish = (ctx, t, dur, o = {}) => { K.vignette(ctx, o.vignette ?? 1); K.grain(ctx, t, dur, o.grain ?? 1); };

  // ---------- paper
  // ivory paper tile (fibres + tooth), used as a pattern so the texture travels with the sheet
  function paperTile(size, base, seed, strength = 1) {
    const cv = K.canvas(size, size), x = cv.getContext('2d'), im = x.createImageData(size, size), d = im.data, b = K.rgb(base);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      // periodic fbm so the tile repeats cleanly
      const u = i / size, v = j / size;
      const lo = K.pnoise2p(u * 6, v * 6, 6, seed) * 0.6 + K.pnoise2p(u * 24, v * 24, 24, seed + 5) * 0.4;
      const fib = K.pnoise2p(u * 90, v * 12, [90, 12], seed + 9);
      const k = 1 + strength * (lo * 0.018 + fib * 0.012 + (K.hash(i + j * size, seed + 3) - 0.5) * 0.03);
      const o = (i + j * size) * 4;
      d[o] = clamp(b[0] * k, 0, 255); d[o + 1] = clamp(b[1] * k, 0, 255); d[o + 2] = clamp(b[2] * k, 0, 255); d[o + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    return cv;
  }
  // periodic 2D value noise on a lattice with period P (number or [Px, Py])
  K.pnoise2p = (x, y, P, s = 0) => {
    const px = Array.isArray(P) ? P[0] : P, py = Array.isArray(P) ? P[1] : P;
    const i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
    const w = (a, m) => ((a % m) + m) % m;
    const h = (a, b) => K.hash(w(a, px) * 7919 + w(b, py) * 104729, s);
    return lerp(lerp(h(i, j), h(i + 1, j), fx), lerp(h(i, j + 1), h(i + 1, j + 1), fx), fy) * 2 - 1;
  };
  K.paper = (ctx, tone = C.ivory, seed = 1, strength = 1) => {
    const tile = K.cached('paper' + tone + seed + '_' + strength, () => paperTile(256, tone, seed, strength));
    return ctx.createPattern(tile, 'repeat');
  };

  // torn paper sprite: a sheet of ochre (or zebra / ivory) paper whose inner edges are torn, with the pale fibre
  // rim, tooth, fibres and a fine ink sketch like the deck's collage art. Cached per device scale.
  // spec: { key, pts: [[x,y]...] polygon (design px), torn: [bool per edge], tone: 'ochre'|'zebra'|'ivory'|'rust',
  //         seed, sketch: 'compass'|'grid'|'none', light: 0..1 (how dim the sheet sits in the scene) }
  K.torn = (ctx, env, spec) => {
    const key = 'torn:' + spec.key + ':' + env.q;
    const spr = K.cached(key, () => makeTorn(spec, env.q));
    ctx.drawImage(spr.cv, spr.x, spr.y, spr.w, spr.h);
  };
  function tornOutline(spec) {
    const r = K.rng(spec.seed * 97 + 13), pts = spec.pts, n = pts.length, outer = [], inner = [];
    for (let e = 0; e < n; e++) {
      const [x0, y0] = pts[e], [x1, y1] = pts[(e + 1) % n], L = Math.hypot(x1 - x0, y1 - y0);
      const nx = (y1 - y0) / L, ny = -(x1 - x0) / L;          // outward normal for a clockwise polygon (screen coords)
      const torn = spec.torn ? spec.torn[e] : true, steps = Math.max(2, Math.round(L / 2.2)), sd = spec.seed * 31 + e * 7;
      for (let k = 0; k < steps; k++) {
        const u = k / steps, x = lerp(x0, x1, u), y = lerp(y0, y1, u);
        if (!torn) { outer.push([x, y]); inner.push([x, y]); continue; }
        const s = u * L, taper = Math.min(1, s / 30, (L - s) / 30);
        const d = (K.noise1(s / 46, sd) * 9 + K.noise1(s / 11, sd + 1) * 3.2 + (r() - 0.5) * 1.8) * taper;
        const rim = (2.2 + 2.6 * (0.5 + 0.5 * K.noise1(s / 17, sd + 2)) + r() * 1.2) * taper;
        outer.push([x + nx * d, y + ny * d]);
        inner.push([x + nx * (d - rim), y + ny * (d - rim)]);
      }
    }
    return { outer, inner };
  }
  function makeTorn(spec, dev) {
    const xs = spec.pts.map(p => p[0]), ys = spec.pts.map(p => p[1]);
    const pad = 16, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
    const w = x1 - x0, h = y1 - y0, cv = K.canvas(w * dev, h * dev), x = cv.getContext('2d');
    x.scale(dev, dev); x.translate(-x0, -y0); x.lineCap = 'round'; x.lineJoin = 'round';
    const { outer, inner } = tornOutline(spec);
    const poly = p => { x.beginPath(); p.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); };
    // soft contact shadow
    x.save(); x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 18 * dev; x.shadowOffsetY = 6 * dev; poly(outer); x.fillStyle = '#1a1510'; x.fill(); x.restore();
    // fibre rim (exposed paper core)
    poly(outer); x.fillStyle = spec.tone === 'zebra' ? '#EDE7DA' : '#F0E6CF'; x.fill();
    // body
    x.save(); poly(inner); x.clip();
    const tone = spec.tone || 'ochre';
    const base = tone === 'ochre' ? '#DFA83F' : tone === 'rust' ? '#B4532E' : tone === 'ivory' ? '#EFEAE0' : '#EDE7DA';
    x.fillStyle = base; x.fillRect(x0, y0, w, h);
    if (tone === 'zebra') {
      x.save(); x.translate(x0 + w / 2, y0 + h / 2); x.rotate(spec.stripe ?? 0.42);
      x.fillStyle = '#17150F';
      for (let i = -40; i < 40; i++) {
        const sx = i * 26 + K.noise1(i * 0.7, spec.seed) * 3;
        x.beginPath();
        for (let k = 0; k <= 30; k++) { const yy = -900 + k * 60, wob = K.noise1(i * 3.1 + k * 0.4, spec.seed + 3) * 2.2; x.lineTo(sx + wob, yy); }
        for (let k = 30; k >= 0; k--) { const yy = -900 + k * 60, wob = K.noise1(i * 5.3 + k * 0.4, spec.seed + 4) * 2.2; x.lineTo(sx + 12.5 + wob, yy); }
        x.closePath(); x.fill();
      }
      x.restore();
    }
    // tooth, blotches and fibres, baked at device resolution
    const W2 = cv.width, H2 = cv.height, im = x.getImageData(0, 0, W2, H2), d = im.data, rr = K.rng(spec.seed * 7 + 1);
    const blot = tone === 'zebra' ? 0.05 : 0.10;
    for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
      const o = (i + j * W2) * 4; if (d[o + 3] === 0) continue;
      const u = x0 + i / dev, v = y0 + j / dev;
      const k = 1 + K.fbm2(u / 90, v / 90, spec.seed, 3) * blot + K.noise2(u / 3.2, v / 14, spec.seed + 2) * 0.035 + (rr() - 0.5) * 0.07;
      d[o] = clamp(d[o] * k, 0, 255); d[o + 1] = clamp(d[o + 1] * k * (tone === 'ochre' ? 0.995 : 1), 0, 255); d[o + 2] = clamp(d[o + 2] * k, 0, 255);
    }
    x.putImageData(im, 0, 0);
    // ink sketch (engineer's field notebook): compass arcs, radials, ticks, a pinned centre
    if (spec.sketch !== 'none') {
      const r = K.rng(spec.seed * 5 + 3), cx = spec.sx ?? lerp(x0, x1, 0.35 + r() * 0.3), cy = spec.sy ?? lerp(y0, y1, 0.35 + r() * 0.3);
      x.strokeStyle = 'rgba(28,20,10,0.72)'; x.fillStyle = 'rgba(28,20,10,0.8)';
      x.lineWidth = 1.35;
      for (let k = 0; k < 4; k++) { const rad = 40 + k * 34 + r() * 16, a0 = r() * TAU; x.beginPath(); x.arc(cx, cy, rad, a0, a0 + 1.6 + r() * 2.8); x.stroke(); }
      x.lineWidth = 1.05;
      for (let k = 0; k < 7; k++) { const a = r() * TAU, r0 = 10 + r() * 20, r1 = 120 + r() * 140; x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke(); }
      // ticks along one arc
      const tr = 96 + r() * 30, ta = r() * TAU;
      for (let k = 0; k < 16; k++) { const a = ta + k * 0.07, l = k % 4 === 0 ? 11 : 6; x.beginPath(); x.moveTo(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr); x.lineTo(cx + Math.cos(a) * (tr + l), cy + Math.sin(a) * (tr + l)); x.stroke(); }
      x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.stroke(); x.beginPath(); x.arc(cx, cy, 1.8, 0, TAU); x.fill();
      // faint pencil construction
      x.strokeStyle = 'rgba(24,20,14,0.22)'; x.lineWidth = 0.8;
      for (let k = 0; k < 3; k++) { const rad = 170 + k * 70 + r() * 30; x.beginPath(); x.arc(cx + (r() - 0.5) * 60, cy + (r() - 0.5) * 60, rad, 0, TAU); x.stroke(); }
    }
    // light falloff across the sheet (it sits in a dark scene)
    const lg = x.createLinearGradient(x0, y0, x1, y1), dim = spec.dim ?? 0.2;
    const lit = spec.lit ?? 0; // 0 = light from top-left, 1 = from bottom-right
    lg.addColorStop(0, `rgba(10,8,6,${lit ? dim : dim * 0.15})`); lg.addColorStop(1, `rgba(10,8,6,${lit ? dim * 0.15 : dim})`);
    x.fillStyle = lg; x.fillRect(x0, y0, w, h);
    x.restore();
    // fibre rim hairs
    x.strokeStyle = 'rgba(250,244,230,0.55)'; x.lineWidth = 0.6;
    const rr2 = K.rng(spec.seed + 77);
    for (let k = 0; k < outer.length; k += 9) {
      if (rr2() < 0.5) continue;
      const [a, b] = outer[k], ang = rr2() * TAU, l = 2 + rr2() * 5;
      x.beginPath(); x.moveTo(a, b); x.lineTo(a + Math.cos(ang) * l, b + Math.sin(ang) * l); x.stroke();
    }
    return { cv, x: x0, y: y0, w, h };
  }

  // ---------- ink paths (arrays of [x,y]; draw-on by arc length)
  const P = K.P = {};
  P.line = (x0, y0, x1, y1, step = 6) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)), o = []; for (let i = 0; i <= n; i++) o.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)]); return o; };
  P.arc = (cx, cy, r, a0, a1, step = 6) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step)), o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  P.bez = (p0, p1, p2, p3, n = 40) => { const o = []; for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; o.push([v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]); } return o; };
  // rounded rect, clockwise from the top-left straight edge start
  P.rrect = (x, y, w, h, r, step = 6) => {
    r = Math.min(r, w / 2, h / 2);
    const o = [];
    const add = a => { for (const q of a) { const l = o[o.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 0.01) o.push(q); } };
    add(P.line(x + r, y, x + w - r, y, step)); add(P.arc(x + w - r, y + r, r, -Math.PI / 2, 0, step));
    add(P.line(x + w, y + r, x + w, y + h - r, step)); add(P.arc(x + w - r, y + h - r, r, 0, Math.PI / 2, step));
    add(P.line(x + w - r, y + h, x + r, y + h, step)); add(P.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI, step));
    add(P.line(x, y + h - r, x, y + r, step)); add(P.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5, step));
    return o;
  };
  P.join = (...parts) => { const o = []; for (const p of parts) for (const q of p) o.push(q); return o; };
  P.lens = pts => { if (pts.L) return pts.L; const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); pts.L = L; return L; };
  P.at = (pts, f) => {
    const L = P.lens(pts), T = L[L.length - 1] * clamp(f);
    let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < T) lo = m; else hi = m; }
    const seg = L[hi] - L[lo] || 1, u = (T - L[lo]) / seg;
    return [lerp(pts[lo][0], pts[hi][0], u), lerp(pts[lo][1], pts[hi][1], u), Math.atan2(pts[hi][1] - pts[lo][1], pts[hi][0] - pts[lo][0])];
  };
  // hand wobble: offsets along normals by seeded noise (static per path)
  P.wob = (pts, amp = 1.2, seed = 1, freq = 60) => {
    const L = P.lens(pts), o = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const d = K.noise1(L[i] / freq, seed) * amp + K.noise1(L[i] / (freq * 0.23), seed + 1) * amp * 0.35;
      o.push([pts[i][0] - dy / l * d, pts[i][1] + dx / l * d]);
    }
    return o;
  };
  // trace the part of a path between fractions a..b (by length) into the current path
  P.trace = (ctx, pts, a = 0, b = 1, move = true) => {
    a = clamp(a); b = clamp(b); if (b <= a) return false;
    const L = P.lens(pts), T = L[L.length - 1], sa = a * T, sb = b * T;
    let started = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const l0 = L[i], l1 = L[i + 1]; if (l1 < sa) continue; if (l0 > sb) break;
      const seg = l1 - l0 || 1, u0 = clamp((sa - l0) / seg), u1 = clamp((sb - l0) / seg);
      const x0 = lerp(pts[i][0], pts[i + 1][0], u0), y0 = lerp(pts[i][1], pts[i + 1][1], u0);
      const x1 = lerp(pts[i][0], pts[i + 1][0], u1), y1 = lerp(pts[i][1], pts[i + 1][1], u1);
      if (!started) { if (move) ctx.moveTo(x0, y0); else ctx.lineTo(x0, y0); started = true; }
      ctx.lineTo(x1, y1);
    }
    return started;
  };
  K.ink = (ctx, pts, o = {}) => {
    const a = o.from ?? 0, b = o.to ?? 1; if (b <= a) return;
    ctx.save();
    ctx.strokeStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1); ctx.lineWidth = o.w ?? 2.4;
    if (o.dash) ctx.setLineDash(o.dash); if (o.dashOff) ctx.lineDashOffset = o.dashOff;
    ctx.beginPath(); P.trace(ctx, pts, a, b); if (o.close && a <= 0 && b >= 1) ctx.closePath(); ctx.stroke();
    ctx.restore();
  };
  // pen-pressure ribbon: a filled stroke whose width follows `wf(dx, dy, f)` (unit tangent, fraction along)
  K.ribbon = (ctx, pts, o = {}) => {
    const a = clamp(o.from ?? 0), b = clamp(o.to ?? 1); if (b <= a) return;
    const L = P.lens(pts), T = L[L.length - 1], wf = o.wf || (() => o.w ?? 2.4);
    const sub = [];
    for (let i = 0; i < pts.length; i++) { const f = L[i] / T; if (f >= a && f <= b) sub.push([pts[i][0], pts[i][1], f]); }
    const pa = P.at(pts, a), pb = P.at(pts, b);
    sub.unshift([pa[0], pa[1], a]); sub.push([pb[0], pb[1], b]);
    if (sub.length < 2) return;
    const left = [], right = [];
    for (let i = 0; i < sub.length; i++) {
      const p0 = sub[Math.max(0, i - 1)], p1 = sub[Math.min(sub.length - 1, i + 1)];
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const hw = wf(dx, dy, sub[i][2]) / 2;
      left.push([sub[i][0] - dy * hw, sub[i][1] + dx * hw]); right.push([sub[i][0] + dy * hw, sub[i][1] - dx * hw]);
    }
    ctx.save(); ctx.fillStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1);
    ctx.beginPath(); left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath(); ctx.fill();
    const cap = (p, r) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill(); };
    cap(sub[0], wf(1, 0, a) / 2); cap(sub[sub.length - 1], wf(1, 0, b) / 2);
    ctx.restore();
  };
  // dotted leader: round dots every `gap` px along the drawn part
  K.dots = (ctx, pts, o = {}) => {
    const a = o.from ?? 0, b = o.to ?? 1; if (b <= a) return;
    const L = P.lens(pts), T = L[L.length - 1], gap = o.gap ?? 11, r = o.r ?? 1.7, off = ((o.off ?? 0) % gap + gap) % gap;
    ctx.save(); ctx.fillStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1); ctx.beginPath();
    for (let s = off; s <= T; s += gap) { const f = s / T; if (f < a || f > b) continue; const [x, y] = P.at(pts, f); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.fill(); ctx.restore();
  };
  K.arrow = (ctx, x, y, ang, o = {}) => {
    const s = o.size ?? 11; ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.strokeStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1); ctx.lineWidth = o.w ?? 2;
    ctx.beginPath(); ctx.moveTo(-s, -s * 0.62); ctx.lineTo(0, 0); ctx.lineTo(-s, s * 0.62); ctx.stroke(); ctx.restore();
  };
  // a glowing clay nib: the one warm point that does the work
  K.nib = (ctx, x, y, a = 1, r = 5) => {
    if (a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
    g.addColorStop(0, `rgba(255,190,150,${0.55 * a})`); g.addColorStop(0.25, `rgba(217,119,87,${0.28 * a})`); g.addColorStop(1, 'rgba(217,119,87,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
    ctx.restore();
    ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = '#FFE6D6'; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.fill(); ctx.restore();
  };
  K.glow = (ctx, x, y, r, hex, a, o = {}) => {
    if (a <= 0) return;
    ctx.save(); if (o.add !== false) ctx.globalCompositeOperation = 'lighter';
    if (o.sx || o.sy) { ctx.translate(x, y); ctx.scale(o.sx || 1, o.sy || 1); x = 0; y = 0; }
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, K.rgba(hex, a)); g.addColorStop(0.4, K.rgba(hex, a * 0.32)); g.addColorStop(1, K.rgba(hex, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
  };
  K.rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); };
  // soft drop shadow under a card, in design px (shadow params are device px, so scale by env.dev)
  K.shadow = (ctx, env, fn, o = {}) => {
    ctx.save(); ctx.shadowColor = o.color || 'rgba(0,0,0,0.6)'; ctx.shadowBlur = (o.blur ?? 50) * env.dev * (o.k ?? 1);
    ctx.shadowOffsetY = (o.y ?? 26) * env.dev * (o.k ?? 1); ctx.shadowOffsetX = (o.x ?? 0) * env.dev * (o.k ?? 1);
    fn(); ctx.restore();
  };

  // ---------- type
  const SERIF = "Newsreader, 'Iowan Old Style', Charter, Georgia, serif";
  const SANS = "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  K.SERIF = SERIF; K.SANS = SANS;
  const setSerif = (ctx, o) => { ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 500} 36px ${SERIF}`; ctx.letterSpacing = `${((o.track ?? -0.018) * 36).toFixed(3)}px`; };
  // Newsreader 500 at opsz 36 (set at 36px, scaled to `size`)
  K.serif = (ctx, str, x, y, size, o = {}) => {
    ctx.save(); ctx.translate(x, y); const k = size / 36; ctx.scale(k, k); if (o.rot) ctx.rotate(o.rot);
    setSerif(ctx, o); ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1);
    ctx.fillText(str, 0, 0); ctx.restore();
  };
  K.serifW = (ctx, str, size, o = {}) => { ctx.save(); setSerif(ctx, o); const w = ctx.measureText(str).width - (o.track ?? -0.018) * 36; ctx.restore(); return w * size / 36; };
  K.sans = (ctx, str, x, y, size, o = {}) => {
    ctx.save(); ctx.font = `${o.weight || 500} ${size}px ${SANS}`; ctx.letterSpacing = `${((o.track ?? 0.16) * size).toFixed(3)}px`;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = o.color || C.moon; ctx.globalAlpha *= (o.alpha ?? 1);
    // centred text: letterSpacing adds a trailing gap, shift it back by half
    const shift = (o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0) * (o.track ?? 0.16) * size;
    ctx.fillText(o.caps ? str.toUpperCase() : str, x + shift, y); ctx.restore();
  };
  K.sansW = (ctx, str, size, o = {}) => { ctx.save(); ctx.font = `${o.weight || 500} ${size}px ${SANS}`; ctx.letterSpacing = `${((o.track ?? 0.16) * size).toFixed(3)}px`; const w = ctx.measureText(o.caps ? str.toUpperCase() : str).width; ctx.restore(); return w - (o.track ?? 0.16) * size; };

  // ---------- real logos as vector paths (crisp at any size, no image decode)
  // Firecrawl wordmark: firecrawl.dev press kit (via levels/06-savee/assets/logos/firecrawl-wordmark.svg), viewBox 172x40.
  // Flame keeps its brand orange; the letters are drawn in moon ivory for the dark ground (the kit's letters are #262626).
  // Claude mark, viewBox 24x24.
  const LOGO = K.LOGO = {
    fcFlame: "M23.3606 12.8281C21.8137 13.2873 20.6476 14.3261 19.7936 15.4544C19.6102 15.6966 19.228 15.5146 19.3008 15.2178C20.936 8.49401 18.7759 2.90556 12.0422 0.154735C11.7006 0.0147436 11.345 0.321324 11.4346 0.679702C14.4977 12.9779 1.61412 11.9406 3.24224 25.8823C3.27024 26.1217 3.00145 26.2855 2.80546 26.1455C2.19509 25.7073 1.51332 24.7932 1.04575 24.1506C0.908555 23.9616 0.611769 24.0148 0.548773 24.2402C0.176391 25.5869 0 26.8553 0 28.1152C0 33.0149 2.51847 37.328 6.33048 39.8283C6.54887 39.9711 6.82886 39.7667 6.75466 39.5161C6.55867 38.8581 6.44808 38.1638 6.43968 37.4456C6.43968 37.0046 6.46768 36.5539 6.53627 36.1339C6.69587 35.0784 7.06265 34.0732 7.67862 33.1577C9.79111 29.9869 14.0259 26.9239 13.3497 22.7647C13.3063 22.5015 13.6171 22.328 13.8131 22.5085C16.7964 25.2342 17.3871 28.9005 16.8972 32.1889C16.8552 32.4745 17.2135 32.6271 17.3941 32.4031C17.8505 31.832 18.4077 31.3308 19.0138 30.9542C19.165 30.8604 19.3666 30.9318 19.424 31.0998C19.7614 32.0811 20.2626 33.0023 20.7358 33.9234C21.3013 35.0308 21.6023 36.2949 21.5547 37.6332C21.5309 38.2842 21.4231 38.9141 21.2425 39.5133C21.1655 39.7667 21.4427 39.9781 21.6653 39.8325C25.4801 37.3322 28 33.0191 28 28.1166C28 26.4129 27.7018 24.7428 27.1376 23.1777C25.9547 19.8949 22.9533 17.4297 23.712 13.1515C23.7484 12.9471 23.5594 12.7693 23.3606 12.8281Z",
    fcLetters: ["M41 34.0521V10.9618H55.7586V14.3264H44.7969V21.0226H53.8436V24.2882H44.7969V34.0521H41Z", "M59.9569 14.7882C58.7352 14.7882 57.7777 13.8976 57.7777 12.6441C57.7777 11.3906 58.7352 10.5 59.9569 10.5C61.1785 10.5 62.136 11.3906 62.136 12.6441C62.136 13.8976 61.1785 14.7882 59.9569 14.7882ZM58.1409 34.0521V17.1632H61.7068V34.0521H58.1409Z", "M73.5885 17.1632H74.3809V20.4948H72.796C69.6264 20.4948 68.6029 22.9687 68.6029 25.5747V34.0521H65.0371V17.1632H68.2067L68.6029 19.7031C69.4613 18.2847 70.815 17.1632 73.5885 17.1632Z", "M83.632 34.25C78.3163 34.25 74.9816 30.8194 74.9816 25.6406C74.9816 20.4288 78.3163 16.9653 83.3019 16.9653C88.1884 16.9653 91.457 20.066 91.5561 25.0139C91.5561 25.4427 91.5231 25.9045 91.457 26.3663H78.7125V26.5972C78.8116 29.467 80.6275 31.3472 83.4339 31.3472C85.613 31.3472 87.1979 30.2587 87.6931 28.3785H91.2589C90.6646 31.7101 87.8252 34.25 83.632 34.25ZM78.8446 23.7604H87.8582C87.561 21.2535 85.8112 19.8351 83.3349 19.8351C81.0567 19.8351 79.1087 21.3524 78.8446 23.7604Z", "M102.033 34.25C96.9151 34.25 93.6465 30.9184 93.6465 25.6406C93.6465 20.4288 97.0142 16.9653 102.132 16.9653C106.49 16.9653 109.197 19.3733 109.891 23.1997H106.16C105.698 21.2205 104.278 20 102.066 20C99.1933 20 97.3113 22.309 97.3113 25.6406C97.3113 28.9392 99.1933 31.2153 102.066 31.2153C104.245 31.2153 105.698 29.9618 106.127 28.0156H109.891C109.23 31.842 106.358 34.25 102.033 34.25Z", "M121.006 17.1632H121.799V20.4948H120.214C117.044 20.4948 116.021 22.9687 116.021 25.5747V34.0521H112.455V17.1632H115.625L116.021 19.7031C116.879 18.2847 118.233 17.1632 121.006 17.1632Z", "M130.614 16.9653C135.104 16.9653 137.679 19.1094 137.679 23.1007V34.0521H134.576L134.279 31.6441C133.123 33.1615 131.505 34.25 128.831 34.25C125.133 34.25 122.657 32.4358 122.657 29.3021C122.657 25.8385 125.166 23.8924 129.92 23.8924H134.147V22.8698C134.147 20.9896 132.793 19.8351 130.449 19.8351C128.336 19.8351 126.916 20.8247 126.652 22.309H123.152C123.515 19.0104 126.355 16.9653 130.614 16.9653ZM129.425 31.4792C132.397 31.4792 134.114 29.7309 134.147 27.125V26.5312H129.722C127.51 26.5312 126.289 27.3559 126.289 29.0712C126.289 30.4896 127.477 31.4792 129.425 31.4792Z", "M144.653 34.0521L139.139 17.1632H142.903L146.766 30.0937L150.629 17.1632H153.897L157.595 30.0937L161.59 17.1632H165.222L159.609 34.0521H155.779L152.214 22.5729L148.516 34.0521H144.653Z", "M166.934 34.0521V10.9618H170.5V34.0521H166.934Z"],
    claude: "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
  };
  const p2d = {}; const path2d = d => p2d[d] || (p2d[d] = new Path2D(d));
  // Firecrawl logo, left/top at x,y, height h (px of the 40-unit viewBox). o.mark = flame only. Returns drawn width.
  K.firecrawl = (ctx, x, y, h, o = {}) => {
    const s = h / 40;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= (o.alpha ?? 1);
    ctx.fillStyle = o.flame || '#FA5D19'; ctx.fill(path2d(LOGO.fcFlame));
    if (!o.mark) { ctx.fillStyle = o.ink || C.moon; for (const d of LOGO.fcLetters) ctx.fill(path2d(d)); }
    ctx.restore();
    return (o.mark ? 28 : 172) * s;
  };
  K.claudeMark = (ctx, cx, cy, size, col = C.clay, a = 1) => {
    const s = size / 24; ctx.save(); ctx.globalAlpha *= a; ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(s, s);
    ctx.fillStyle = col; ctx.fill(path2d(LOGO.claude), 'evenodd'); ctx.restore();
  };
  // render another story loop live inside a rect of this frame (the levels journey and the finale use it)
  K.mini = (ctx, key, t, x, y, w, h) => {
    const L = window.STORY_LOOPS[key]; if (!L) return;
    ctx.save(); ctx.translate(x, y); L.render(ctx, t, w, h); ctx.restore();
  };

  // ---------- loop registration helper: wraps a scene draw fn with begin/ground/finish
  K.loop = (n, dur, scene, o = {}) => {
    window.STORY_LOOPS[n] = {
      dur,
      render(ctx, t, w, h) {
        t = ((t % dur) + dur) % dur;
        const env = K.begin(ctx, w, h), p = t / dur;
        env.t = t; env.p = p; env.dur = dur;
        K.ground(ctx, p, o.ground || {});
        scene(ctx, t, env);
        K.finish(ctx, t, dur, o.finish || {});
        K.end(ctx);
      },
    };
  };
})();
