/* Level 6 · Motion Library · "Unlimited styles"
 * set-up : a wall of tiny tiles, every one a different style, all animating
 * turn   : a cursor glides in and picks one; it grows into a large live preview while the wall dims
 * pay-off: Launch; a clay pulse; the preview settles back into the wall and the cursor leaves */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10;
  const COLS = 11, ROWS = 6, TW = 148, TH = 92, GAP = 14;
  const WX = 960 - (COLS * TW + (COLS - 1) * GAP) / 2, WY = 300;
  const PICK = 2 * COLS + 5;
  const PREV = { w: 980, h: 980 * TH / TW }; PREV.x = 960 - PREV.w / 2; PREV.y = 292;
  const rectOf = i => ({ x: WX + (i % COLS) * (TW + GAP), y: WY + Math.floor(i / COLS) * (TH + GAP), w: TW, h: TH });

  // ---- palettes (warm, muted; clay only as an accent; never blue)
  const PALS = [
    ['#141413', '#F4F1EA', '#D97757'], ['#F1EEE5', '#141413', '#D97757'], ['#DFA83F', '#141413', '#F4F1EA'], ['#7E3A22', '#F2C9B0', '#FAF9F5'],
    ['#D8CBB0', '#2A241C', '#B5532F'], ['#3E3D2A', '#E3D9BE', '#DFA83F'], ['#1C1D22', '#F2C9B0', '#D97757'], ['#3A2430', '#F2C9B0', '#DFA83F'],
    ['#9AA58A', '#1D2118', '#F4F1EA'], ['#EFE3C8', '#7E3A22', '#D97757'], ['#0B0C10', '#DFA83F', '#F4F1EA'], ['#2B4038', '#E9E1CC', '#DFA83F'],
    ['#5C2A2A', '#F0D8C8', '#F4F1EA'], ['#C9B99A', '#3A2A1E', '#7E3A22'],
  ];
  // ---- styles: each draws a looping motion study in a w x h box (phase w = TAU * t / DUR)
  const S = [];
  S.push(function orbit(c, w, h, ph, [bg, fg, ac]) { const r = Math.min(w, h) * 0.3; c.strokeStyle = fg; c.globalAlpha = 0.45; c.lineWidth = Math.max(1.2, r * 0.05); c.beginPath(); c.arc(w / 2, h / 2, r, 0, TAU); c.stroke(); c.globalAlpha = 1; c.fillStyle = ac; c.beginPath(); c.arc(w / 2 + Math.cos(ph * 2) * r, h / 2 + Math.sin(ph * 2) * r, r * 0.2, 0, TAU); c.fill(); c.fillStyle = fg; c.beginPath(); c.arc(w / 2 + Math.cos(-ph * 3) * r * 0.5, h / 2 + Math.sin(-ph * 3) * r * 0.5, r * 0.1, 0, TAU); c.fill(); });
  S.push(function bars(c, w, h, ph, [bg, fg, ac]) { const n = 7, bw = w / (n * 1.8); for (let k = 0; k < n; k++) { const v = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(ph * 3 + k * 0.9)); c.fillStyle = k === 4 ? ac : fg; c.fillRect(w * 0.14 + k * bw * 1.8, h * 0.84 - v * h * 0.66, bw, v * h * 0.66); } });
  S.push(function waves(c, w, h, ph, [bg, fg, ac]) { for (let j = 0; j < 3; j++) { c.strokeStyle = j === 1 ? ac : fg; c.lineWidth = Math.max(1.4, h * 0.03); c.beginPath(); for (let x = 0; x <= w; x += w / 40) { const y = h * (0.32 + j * 0.18) + Math.sin(x / w * TAU * 1.5 - ph * 2 + j) * h * 0.08; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); } });
  S.push(function dots(c, w, h, ph, [bg, fg, ac]) { const nx = 8, ny = 5, A = new Path2D(), B = new Path2D(); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const v = 0.5 + 0.5 * Math.sin(ph * 2 - (i + j) * 0.7), x = (i + 0.5) * w / nx, y = (j + 0.5) * h / ny, r = Math.min(w / nx, h / ny) * 0.34 * (0.25 + 0.75 * v), q = (i + j) % 7 === 3 ? B : A; q.moveTo(x + r, y); q.arc(x, y, r, 0, TAU); } c.fillStyle = fg; c.fill(A); c.fillStyle = ac; c.fill(B); });
  S.push(function squares(c, w, h, ph, [bg, fg, ac]) { c.save(); c.translate(w / 2, h / 2); const r = Math.min(w, h) * 0.34; for (let k = 0; k < 3; k++) { c.save(); c.rotate(ph * (k % 2 ? -1 : 1) + k * 0.3); const s = r * (1 - k * 0.28); c.strokeStyle = k === 2 ? ac : fg; c.lineWidth = Math.max(1.4, r * 0.06); c.strokeRect(-s, -s, 2 * s, 2 * s); c.restore(); } c.restore(); });
  S.push(function zebra(c, w, h, ph, [bg, fg, ac]) { c.save(); c.fillStyle = fg; const sw = Math.max(6, w / 12), off = (ph / TAU) * sw * 8 % (sw * 2); c.translate(w / 2, h / 2); c.rotate(-0.6); for (let x = -w - sw * 2 + off; x < w + sw * 2; x += sw * 2) c.fillRect(x, -w, sw, 2 * w); c.restore(); c.fillStyle = ac; c.beginPath(); c.arc(w * 0.78, h * 0.3, Math.min(w, h) * 0.1, 0, TAU); c.fill(); });
  S.push(function ripple(c, w, h, ph, [bg, fg, ac]) { const R = Math.max(w, h) * 0.6; for (let k = 0; k < 4; k++) { const u = ((ph / TAU) * 2 + k / 4) % 1; c.globalAlpha = 1 - u; c.strokeStyle = k === 0 ? ac : fg; c.lineWidth = Math.max(1.2, h * 0.025); c.beginPath(); c.arc(w / 2, h / 2, u * R, 0, TAU); c.stroke(); } c.globalAlpha = 1; });
  S.push(function sweep(c, w, h, ph, [bg, fg, ac]) { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg); g.addColorStop(1, fg); c.globalAlpha = 0.35; c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalAlpha = 1; const x = ((ph / TAU) * 2 % 1) * (w * 1.6) - w * 0.3; const g2 = c.createLinearGradient(x - w * 0.2, 0, x + w * 0.2, 0); g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, K.rgba(ac, 0.8)); g2.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g2; c.fillRect(0, 0, w, h); });
  S.push(function rise(c, w, h, ph, [bg, fg, ac], sd) { const A = new Path2D(), B = new Path2D(); for (let k = 0; k < 14; k++) { const x = K.hash(k, sd) * w, sp = 1 + Math.floor(K.hash(k, sd + 1) * 2), y = h - (((ph / TAU) * sp + K.hash(k, sd + 2)) % 1) * (h * 1.2) + h * 0.1, r = Math.min(w, h) * (0.02 + 0.03 * K.hash(k, sd + 3)), q = k % 5 === 0 ? B : A; q.moveTo(x + r, y); q.arc(x, y, r, 0, TAU); } c.fillStyle = fg; c.fill(A); c.fillStyle = ac; c.fill(B); });
  S.push(function horizon(c, w, h, ph, [bg, fg, ac]) { const R = w * 1.3, cy = h * 0.78 + R; c.fillStyle = K.rgba(ac, 0.9); c.beginPath(); c.arc(w / 2, h * 0.7 - Math.sin(ph) * h * 0.12, h * 0.1, 0, TAU); c.fill(); c.fillStyle = fg; c.globalAlpha = 0.9; c.beginPath(); c.arc(w / 2, cy, R, 0, TAU); c.fill(); c.globalAlpha = 1; c.strokeStyle = ac; c.lineWidth = Math.max(1.2, h * 0.02); c.beginPath(); c.arc(w / 2, cy, R, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35); c.stroke(); });
  S.push(function spiral(c, w, h, ph, [bg, fg, ac]) { c.save(); c.translate(w / 2, h / 2); c.rotate(ph * 2); c.strokeStyle = fg; c.lineWidth = Math.max(1.3, h * 0.022); c.beginPath(); const r = Math.min(w, h) * 0.42; for (let a = 0; a < TAU * 3.2; a += 0.12) { const rr = r * a / (TAU * 3.2); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); c.fillStyle = ac; c.beginPath(); c.arc(r, 0, r * 0.1, 0, TAU); c.fill(); c.restore(); });
  S.push(function checker(c, w, h, ph, [bg, fg, ac]) { const nx = 6, ny = 4, cw = w / nx, ch = h / ny; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const f = Math.cos(ph * 2 - (i - j) * 0.5); c.fillStyle = (i + j) % 2 ? fg : ((i * 3 + j) % 5 === 0 ? ac : bg); c.save(); c.translate((i + 0.5) * cw, (j + 0.5) * ch); c.scale(Math.abs(f), 1); c.fillRect(-cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2); c.restore(); } });
  S.push(function chart(c, w, h, ph, [bg, fg, ac]) { const n = 7, pts = []; for (let k = 0; k < n; k++) pts.push([w * (0.1 + 0.8 * k / (n - 1)), h * (0.78 - 0.5 * (k / (n - 1)) - 0.12 * Math.sin(k * 1.7))]); const f = (ph / TAU * 2) % 1, d = Math.min(1, f * 1.6); c.strokeStyle = fg; c.lineWidth = Math.max(1.4, h * 0.03); c.globalAlpha = K.smooth(K.seg(f, 0, 0.1)) * (1 - K.smooth(K.seg(f, 0.8, 1))); c.beginPath(); const m = d * (n - 1); for (let k = 0; k <= Math.floor(m); k++) k ? c.lineTo(pts[k][0], pts[k][1]) : c.moveTo(pts[k][0], pts[k][1]); const kk = Math.floor(m); if (kk < n - 1) { const u = m - kk; c.lineTo(lerp(pts[kk][0], pts[kk + 1][0], u), lerp(pts[kk][1], pts[kk + 1][1], u)); } c.stroke(); c.fillStyle = ac; c.beginPath(); const q = kk < n - 1 ? [lerp(pts[kk][0], pts[kk + 1][0], m - kk), lerp(pts[kk][1], pts[kk + 1][1], m - kk)] : pts[n - 1]; c.arc(q[0], q[1], h * 0.05, 0, TAU); c.fill(); c.globalAlpha = 1; });
  S.push(function blob(c, w, h, ph, [bg, fg, ac], sd) { c.fillStyle = fg; c.beginPath(); const r = Math.min(w, h) * 0.32; for (let k = 0; k <= 48; k++) { const a = k / 48 * TAU, rr = r * (1 + 0.14 * Math.sin(a * 3 + ph * 2) + 0.08 * Math.sin(a * 5 - ph * 3 + sd)); const x = w / 2 + Math.cos(a) * rr, y = h / 2 + Math.sin(a) * rr; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.fill(); c.fillStyle = ac; c.beginPath(); c.arc(w / 2 + r * 0.3, h / 2 - r * 0.25, r * 0.16, 0, TAU); c.fill(); });
  S.push(function floor(c, w, h, ph, [bg, fg, ac]) { c.strokeStyle = fg; c.lineWidth = Math.max(1, h * 0.012); const hz = h * 0.42; for (let k = -8; k <= 8; k++) { c.beginPath(); c.moveTo(w / 2 + k * w * 0.02, hz); c.lineTo(w / 2 + k * w * 0.2, h); c.stroke(); } for (let k = 0; k < 6; k++) { const u = ((k + (ph / TAU) * 4) % 6) / 6, y = hz + (h - hz) * u * u; c.globalAlpha = u * (1 - K.smooth(K.seg(u, 0.78, 0.98))); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } c.globalAlpha = 1; c.fillStyle = ac; c.beginPath(); c.arc(w / 2, hz - h * 0.1, h * 0.09, 0, TAU); c.fill(); });
  S.push(function bounce(c, w, h, ph, [bg, fg, ac]) { const u = Math.abs(Math.sin(ph * 2)), gy = h * 0.8, r = h * 0.12, y = gy - r - u * h * 0.5, sq = u < 0.12 ? 1 + (0.12 - u) * 2.5 : 1; c.fillStyle = K.rgba(fg, 0.25); c.beginPath(); c.ellipse(w / 2, gy + 2, r * (1.3 - u * 0.6), r * 0.25, 0, 0, TAU); c.fill(); c.fillStyle = ac; c.beginPath(); c.ellipse(w / 2, y + r * (1 - 1 / sq), r * sq, r / sq, 0, 0, TAU); c.fill(); c.strokeStyle = fg; c.lineWidth = Math.max(1, h * 0.015); c.beginPath(); c.moveTo(w * 0.15, gy); c.lineTo(w * 0.85, gy); c.stroke(); });
  S.push(function petals(c, w, h, ph, [bg, fg, ac]) { c.save(); c.translate(w / 2, h / 2); c.rotate(ph); const r = Math.min(w, h) * 0.36; for (let k = 0; k < 6; k++) { c.save(); c.rotate(k * TAU / 6); c.fillStyle = k % 3 === 0 ? ac : fg; c.globalAlpha = 0.85; c.beginPath(); c.ellipse(r * 0.5, 0, r * 0.5, r * 0.16, 0, 0, TAU); c.fill(); c.restore(); } c.restore(); c.globalAlpha = 1; });
  S.push(function amp(c, w, h, ph, [bg, fg, ac]) { const s = 1 + 0.08 * Math.sin(ph * 2); c.save(); c.translate(w / 2, h * 0.64); c.scale(s, s); c.rotate(0.06 * Math.sin(ph)); K.serif(c, '&', 0, h * 0.14, h * 0.86, { color: fg, align: 'center', italic: true, weight: 400 }); c.restore(); c.fillStyle = ac; c.fillRect(w * 0.12, h * 0.82, w * 0.76 * (0.5 + 0.5 * Math.sin(ph * 2)), Math.max(2, h * 0.03)); });
  S.push(function stack(c, w, h, ph, [bg, fg, ac]) { for (let k = 0; k < 3; k++) { const u = (ph / TAU * 2 + k / 3) % 1, x = w * 0.2 + u * w * 0.18, y = h * 0.25 + (1 - u) * h * 0.12; c.globalAlpha = Math.sin(Math.PI * u); c.fillStyle = k === 1 ? ac : fg; c.fillRect(x + k * 6, y, w * 0.46, h * 0.46); } c.globalAlpha = 1; });
  S.push(function donut(c, w, h, ph, [bg, fg, ac]) { const r = Math.min(w, h) * 0.34; c.lineWidth = r * 0.36; const a0 = ph * 2; [[0, 0.46, fg], [0.5, 0.78, ac], [0.82, 0.96, K.rgba(fg, 0.45)]].forEach(([a, b, col]) => { c.strokeStyle = col; c.beginPath(); c.arc(w / 2, h / 2, r, a0 + a * TAU, a0 + b * TAU); c.stroke(); }); });
  S.push(function scan(c, w, h, ph, [bg, fg, ac]) { const y = (((ph / TAU * 2) % 1) * 1.36 - 0.18) * h, A = new Path2D(), B = new Path2D(), r = Math.min(w, h) * 0.025; for (let i = 0; i < 12; i++) for (let j = 0; j < 7; j++) { const py = (j + 0.5) * h / 7, px = (i + 0.5) * w / 12, q = Math.abs(py - y) / h < 0.08 ? B : A; q.moveTo(px + r, py); q.arc(px, py, r, 0, TAU); } c.fillStyle = fg; c.globalAlpha = 0.35; c.fill(A); c.globalAlpha = 1; c.fillStyle = ac; c.fill(B); c.fillRect(0, y - 1, w, 2); });
  S.push(function torn(c, w, h, ph, [bg, fg, ac], sd) { const st = w / 30, per = 16 * st, off = ((ph / TAU) * 2 * per) % per; c.fillStyle = fg; c.beginPath(); c.moveTo(-per, h); for (let k = -16; k <= 48; k++) { const x = k * st + off; c.lineTo(x, h * 0.52 + (K.hash(((k % 16) + 16) % 16, sd) - 0.5) * h * 0.12); } c.lineTo(w + per, h); c.closePath(); c.fill(); c.fillStyle = ac; c.beginPath(); c.arc(w * 0.3, h * 0.28, h * 0.1, 0, TAU); c.fill(); });

  // the picked style: a halftone sunrise whose rings ripple out from the sun (reads at 148 px and at 980 px)
  S.push(function halftone(c, w, h, ph, [bg, fg, ac]) {
    const sp = Math.max(6.5, w / 44), sx = w * 0.5, sy = h * 0.66, hz = h * 0.72;
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, w * 0.7); g.addColorStop(0, 'rgba(217,119,87,0.28)'); g.addColorStop(1, 'rgba(217,119,87,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    const sky = new Path2D(), low = new Path2D(), core = new Path2D();
    for (let j = 0; j * sp < h + sp; j++) for (let i = 0; i * sp < w + sp; i++) {
      const x = (i + 0.5 + (j % 2) * 0.5) * sp, y = (j + 0.5) * sp, d = Math.hypot(x - sx, (y - sy) * 1.25) / h;
      const below = y > hz, isCore = d < 0.13 && !below;
      const v = below ? 0.18 + 0.22 * (0.5 + 0.5 * Math.cos((y - hz) / h * 40 - ph * 3)) : (0.5 + 0.5 * Math.cos(d * 22 - ph * 3)) * Math.exp(-d * 1.5);
      const r = sp * 0.46 * (isCore ? 1 : 0.12 + 0.88 * v), path = isCore ? core : below ? low : sky;
      path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU);
    }
    c.fillStyle = fg; c.globalAlpha = 0.9; c.fill(sky); c.globalAlpha = 0.55; c.fill(low); c.globalAlpha = 1; c.fillStyle = ac; c.fill(core);
    c.strokeStyle = ac; c.lineWidth = Math.max(1.2, h * 0.006); c.beginPath(); c.moveTo(0, hz); c.lineTo(w, hz); c.stroke();
  });

  // which style + palette each tile shows (neighbours never repeat)
  const TILES = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    TILES.push({ s: (c * 5 + r * 3 + (r % 2) * 7) % (S.length - 1), p: (c * 3 + r * 5 + 1) % PALS.length, sd: i * 13 + 7, k: 1 + ((c + r) % 2) });
  }
  TILES[PICK].s = S.findIndex(f => f.name === 'halftone'); TILES[PICK].p = 6;

  function drawTile(ctx, i, x, y, w, h, t, o = {}) {
    const T = TILES[i], pal = PALS[T.p];
    ctx.save(); K.rr(ctx, x, y, w, h, Math.min(10, w * 0.06)); ctx.clip();
    ctx.fillStyle = pal[0]; ctx.fillRect(x, y, w, h);
    ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    S[T.s](ctx, w, h, TAU * t / DUR * T.k, pal, T.sd);
    ctx.restore();
    if (o.frame) { K.rr(ctx, x, y, w, h, Math.min(10, w * 0.06)); ctx.strokeStyle = o.frame; ctx.lineWidth = o.lw || 2; ctx.stroke(); }
  }

  // ---- cursor
  const ARROW = [[0, 0], [0, 17.5], [4.6, 13.4], [7.6, 20.4], [10.4, 19.2], [7.4, 12.4], [13.2, 12.4]];
  function cursor(ctx, env, x, y, press) {
    const s = 2.3 * (1 - 0.1 * press);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    K.shadow(ctx, env, () => { ctx.beginPath(); ARROW.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fillStyle = C.ivory; ctx.fill(); }, { blur: 10, y: 4, color: 'rgba(0,0,0,0.6)', k: s });
    ctx.lineWidth = 1.3 / 1; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  // cursor path: in from the lower right, to the tile, to Launch, out again
  const tileC = (() => { const r = rectOf(PICK); return [r.x + r.w * 0.62, r.y + r.h * 0.6]; })();
  const BTN = { w: 210, h: 60 }; BTN.x = PREV.x + PREV.w - BTN.w - 34; BTN.y = PREV.y + PREV.h - BTN.h - 30;
  const btnC = [BTN.x + BTN.w * 0.55, BTN.y + BTN.h * 0.62];
  const C1 = P.bez([2010, 1150], [1720, 980], [1300, 760], tileC, 50);
  const C2 = P.bez(tileC, [tileC[0] + 120, tileC[1] + 60], [btnC[0] - 140, btnC[1] - 90], btnC, 40);
  const C3 = P.bez(btnC, [btnC[0] + 180, btnC[1] + 60], [1820, 1000], [2040, 1160], 40);
  function cursorAt(t) {
    if (t < 0.7 || t > 8.9) return null;
    if (t < 2.1) return P.at(C1, E.soft(seg(t, 0.7, 2.1)));
    if (t < 3.75) return [tileC[0], tileC[1]];
    if (t < 4.7) return P.at(C2, E.inOut(seg(t, 3.75, 4.7)));
    if (t < 7.3) return [btnC[0], btnC[1]];
    return P.at(C3, E.in(seg(t, 7.3, 8.9)));
  }

  const ART = { key: 'l6-ochre', tone: 'ochre', seed: 61, pts: [[1630, -40], [1960, -40], [1960, 214], [1830, 196], [1690, 110]], torn: [false, false, true, true, true], sketch: 'compass', sx: 1840, sy: 56, dim: 0.14, lit: 1 };

  K.loop(6, DUR, (ctx, t, env) => {
    ctx.save(); ctx.translate(Math.sin(TAU * env.p) * 4, Math.cos(TAU * env.p) * 3); K.torn(ctx, env, ART); ctx.restore();
    // headline
    K.serif(ctx, 'Unlimited styles', 960, 226, 92, { color: C.moon, align: 'center' });
    const grow = E.inOut(seg(t, 2.55, 3.55)) * (1 - E.inOut(seg(t, 6.75, 7.85)));
    const hover = K.env(t, 1.85, 2.2, 2.45, 2.7) * (1 - grow);
    // the wall
    for (let i = 0; i < TILES.length; i++) {
      if (i === PICK) continue;
      const r = rectOf(i); drawTile(ctx, i, r.x, r.y, r.w, r.h, t);
    }
    // edge fades so the wall reads as endless
    for (const [x0, x1] of [[0, 250], [1920, 1670]]) { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(7,8,12,1)'); g.addColorStop(1, 'rgba(7,8,12,0)'); ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x1), WY - 10, 250, ROWS * (TH + GAP) + 20); }
    // dim the wall while the preview is open
    if (grow > 0) { ctx.fillStyle = `rgba(7,8,12,${0.74 * grow})`; ctx.fillRect(0, WY - 20, 1920, ROWS * (TH + GAP) + 40); }
    // the picked tile: lifts on hover, grows into the preview
    const r0 = rectOf(PICK), lift = 1 + 0.08 * hover;
    const x = lerp(r0.x - r0.w * (lift - 1) / 2, PREV.x, grow), y = lerp(r0.y - r0.h * (lift - 1) / 2, PREV.y, grow);
    const w = lerp(r0.w * lift, PREV.w, grow), h = lerp(r0.h * lift, PREV.h, grow);
    if (grow > 0.01) K.shadow(ctx, env, () => { K.rr(ctx, x, y, w, h, 10); ctx.fillStyle = '#000'; ctx.fill(); }, { blur: 80, y: 30, color: 'rgba(0,0,0,0.8)' });
    const launch = seg(t, 4.95, 6.4);
    const edge = hover > 0 || grow > 0 ? K.mix('#F4F1EA', C.clay, Math.max(hover, K.env(t, 4.95, 5.1, 5.6, 6.3))) : null;
    drawTile(ctx, PICK, x, y, w, h, t, { frame: edge, lw: 2 + grow });
    // Launch: a light sweep across the preview + clay rings from the button
    if (launch > 0 && launch < 1) {
      ctx.save(); K.rr(ctx, x, y, w, h, 10); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
      const sx = lerp(x - 260, x + w + 260, E.inOut(seg(t, 4.95, 5.85)));
      ctx.translate(sx, y + h / 2); ctx.rotate(0.32);
      const g = ctx.createLinearGradient(-70, 0, 70, 0);
      g.addColorStop(0, 'rgba(255,226,200,0)'); g.addColorStop(0.5, 'rgba(255,226,200,0.30)'); g.addColorStop(1, 'rgba(255,226,200,0)'); ctx.fillStyle = g; ctx.fillRect(-70, -h, 140, 2 * h);
      ctx.restore();
    }
    // Launch button (inside the preview)
    const bA = E.out(seg(t, 3.35, 3.8)) * (1 - E.inOut(seg(t, 6.6, 6.95)));
    if (bA > 0) {
      const press = K.env(t, 4.9, 4.97, 5.02, 5.2), bs = 1 - 0.06 * press;
      ctx.save(); ctx.globalAlpha = bA; ctx.translate(BTN.x + BTN.w / 2, BTN.y + BTN.h / 2); ctx.scale(bs, bs);
      for (let k = 0; k < 3; k++) {
        const u = seg(t, 4.97 + k * 0.22, 6.1 + k * 0.22); if (u <= 0 || u >= 1) continue;
        ctx.save(); ctx.globalAlpha = bA * (1 - u) * 0.8; K.rr(ctx, -BTN.w / 2 - 70 * E.out(u), -BTN.h / 2 - 70 * E.out(u), BTN.w + 140 * E.out(u), BTN.h + 140 * E.out(u), BTN.h / 2 + 70 * E.out(u)); ctx.strokeStyle = C.clay; ctx.lineWidth = 2.4; ctx.stroke(); ctx.restore();
      }
      K.glow(ctx, 0, 0, 160, C.clay, 0.45 * K.env(t, 4.95, 5.05, 5.4, 6.2));
      K.rr(ctx, -BTN.w / 2, -BTN.h / 2, BTN.w, BTN.h, BTN.h / 2); ctx.fillStyle = C.clay; ctx.fill();
      K.sans(ctx, 'Launch', -18, 9, 25, { weight: 600, track: 0.01, align: 'center', color: C.ivory });
      ctx.strokeStyle = C.ivory; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(52, 8); ctx.lineTo(66, -6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(56, -6); ctx.lineTo(66, -6); ctx.lineTo(66, 4); ctx.stroke();
      ctx.restore();
    }
    // cursor + click ripples
    const cp = cursorAt(t);
    for (const tc of [2.4, 4.95]) {
      const u = seg(t, tc, tc + 0.5);
      if (u > 0 && u < 1 && cp) { ctx.save(); ctx.globalAlpha = 0.7 * (1 - u); ctx.beginPath(); ctx.arc(cp[0], cp[1], 8 + 34 * E.out(u), 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    }
    if (cp) cursor(ctx, env, cp[0], cp[1], Math.max(K.env(t, 2.33, 2.4, 2.45, 2.6), K.env(t, 4.88, 4.95, 5.0, 5.15)));
  }, { ground: { ly: 520 } });
})();
