/* Level 2 · Website · "Sites that live"
 * set-up : a browser frame inks itself over its pencil sketch while Firecrawl pulls the brand from the URL
 * turn   : a voice wave rises in the hero; its peaks lift off as birds; the birds land and become the typed headline
 * pay-off: a footer wordmark writes itself and drifts; the words take flight again and the ink lifts back to pencil */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10;
  const BR = { x: 318, y: 164, w: 1284, h: 740, r: 22 };
  const BAR = 62, FOOT_Y = BR.y + 578;
  const HEAD = { y: 468, size: 116, text: 'Sites that live' };
  const WAVE = { x0: 560, x1: 1360, y: 430 };

  // ---- frame strokes (pencil layer always, ink layer draws on then lifts off)
  const S = [];
  const add = (pts, o = {}) => S.push({ pts: P.wob(pts, o.wob ?? 0.9, S.length + 3, 70), w: o.w ?? 2.2, a: o.a ?? 0.9, t0: o.t0, t1: o.t1, e0: o.e0, e1: o.e1, nib: o.nib });
  add(P.rrect(BR.x, BR.y, BR.w, BR.h, BR.r, 5), { w: 2.6, t0: 0.0, t1: 1.25, e0: 8.2, e1: 9.4, nib: true });
  add(P.line(BR.x + 8, BR.y + BAR, BR.x + BR.w - 8, BR.y + BAR), { w: 1.6, a: 0.45, t0: 0.35, t1: 1.05, e0: 8.35, e1: 9.1 });
  const pill = { x: 960 - 260, y: BR.y + 15, w: 520, h: 32 };
  add(P.rrect(pill.x, pill.y, pill.w, pill.h, 16, 5), { w: 1.6, a: 0.55, t0: 0.55, t1: 1.2, e0: 8.3, e1: 9.0 });
  add(P.line(BR.x + 8, FOOT_Y, BR.x + BR.w - 8, FOOT_Y), { w: 1.6, a: 0.4, t0: 0.7, t1: 1.45, e0: 8.45, e1: 9.3, nib: true });
  // nav row: greeked links at the right (the pulled logo lands at the left)
  for (let k = 0; k < 3; k++) { const x = BR.x + BR.w - 340 + k * 104; add(P.line(x, BR.y + BAR + 44, x + 64, BR.y + BAR + 44, 8), { w: 4.2, a: 0.3, wob: 0.2, t0: 0.95 + k * 0.06, t1: 1.3 + k * 0.06, e0: 8.3 + k * 0.04, e1: 8.8 + k * 0.04 }); }
  // greeked subline under the headline
  add(P.line(960 - 230, HEAD.y + 62, 960 + 230, HEAD.y + 62, 8), { w: 7, a: 0.2, wob: 0.3, t0: 0.9, t1: 1.5, e0: 8.3, e1: 8.9 });
  add(P.line(960 - 160, HEAD.y + 88, 960 + 160, HEAD.y + 88, 8), { w: 7, a: 0.2, wob: 0.3, t0: 1.0, t1: 1.55, e0: 8.35, e1: 8.95 });
  // footer links: three columns right of centre, social dots at the far right
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    const x = 1000 + c * 138, y = FOOT_Y + 46 + r * 24, w = [74, 56, 88, 62, 80, 50, 70, 92, 58][c * 3 + r];
    add(P.line(x, y, x + w, y, 8), { w: 4.2, a: 0.26, wob: 0.2, t0: 1.05 + c * 0.08 + r * 0.04, t1: 1.45 + c * 0.08 + r * 0.04, e0: 8.5 + c * 0.05, e1: 8.95 + c * 0.05 });
  }
  const pencilA = 0.24;

  // ---- footer wordmark: an illegible slanted cursive signature (loops, arches, cusps) with an entry flourish and a swash
  const SIG = (() => {
    const x0 = BR.x + 96, y0 = FOOT_Y + 104, a = 6.6, slant = 0.36;
    // letter spec: [height, loop b]  (b > a loops at the top, b < a arches, b = a cusps)
    const L = [[56, 11], [22, 3.5], [22, 9], [60, 12], [22, 4], [22, 4], [22, 8.5], [52, 11], [22, 3], [22, 9]];
    const pts = [];
    const put = (x, y) => pts.push([x + (y0 - y) * slant, y]);
    // entry flourish: a tall open loop like a capital
    P.bez([x0 - 64, y0 + 4], [x0 - 70, y0 - 96], [x0 - 4, y0 - 104], [x0 - 18, y0 - 40], 26).forEach(([x, y]) => put(x, y));
    P.bez([x0 - 18, y0 - 40], [x0 - 28, y0 - 8], [x0 - 36, y0 + 6], [x0 - 10, y0 + 2], 14).forEach(([x, y]) => put(x, y));
    let th = -Math.PI;
    for (let k = 0; k < L.length; k++) {
      for (let s = 0; s <= 40; s++) {
        const q = th + (s / 40) * K.TAU, f = s / 40, h = L[k][0], b = L[k][1];
        const x = x0 + a * (q + Math.PI) - b * Math.sin(q) + K.noise1(q * 0.4, 5) * 2;
        const y = y0 - h * (1 + Math.cos(q)) / 2 + K.noise1(q * 0.3, 9) * 2.5;
        put(x, y);
      }
      th += K.TAU;
    }
    const e = pts[pts.length - 1];
    P.bez([e[0], e[1]], [e[0] + 44, e[1] - 10], [e[0] + 30, e[1] + 30], [e[0] - 90, e[1] + 26], 26).forEach(p => pts.push(p));
    P.bez([e[0] - 90, e[1] + 26], [e[0] - 240, e[1] + 22], [x0 - 20, y0 + 30], [x0 - 70, y0 + 20], 30).forEach(p => pts.push(p));
    return pts;
  })();
  const sigW = (dx, dy) => 1.5 + 3.6 * Math.max(0, dy) ** 1.5;          // pointed pen: heavier on the downstrokes

  // ---- birds
  function bird(ctx, x, y, s, flap, ang, a) {
    if (a <= 0 || s <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha *= a;
    const lift = Math.sin(flap) * 0.62;
    ctx.strokeStyle = C.moon; ctx.lineWidth = Math.max(1.6, s * 0.16); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, -s * (0.1 + lift)); ctx.quadraticCurveTo(-s * 0.45, -s * (0.34 + lift * 0.4), 0, s * 0.08);
    ctx.quadraticCurveTo(s * 0.45, -s * (0.34 + lift * 0.4), s, -s * (0.1 + lift));
    ctx.stroke();
    ctx.restore();
  }
  const letters = [];     // filled per frame from measureText (fonts may load late in a host page)
  function layout(ctx) {
    const W = K.serifW(ctx, HEAD.text, HEAD.size), x0 = 960 - W / 2;
    letters.length = 0;
    for (let i = 0, j = 0; i < HEAD.text.length; i++) {
      const ch = HEAD.text[i]; if (ch === ' ') continue;
      const xa = x0 + K.serifW(ctx, HEAD.text.slice(0, i), HEAD.size), w = K.serifW(ctx, ch, HEAD.size);
      letters.push({ ch, i, j: j++, x: xa, cx: xa + w / 2, w });
    }
    return { x0, W };
  }
  const NL = 13;
  const landT = j => 4.05 + j * 0.085, spawnT = j => 2.45 + j * 0.06, exitT = j => 7.25 + j * 0.055;
  const peakX = j => lerp(WAVE.x0 + 60, WAVE.x1 - 60, j / (NL - 1));

  function wave(ctx, t) {
    const grow = E.out(seg(t, 1.15, 2.3)), fade = 1 - E.inOut(seg(t, 2.5, 3.7));
    const A = 42 * grow * fade; if (A < 0.3) return;
    const rev = lerp(WAVE.x0, WAVE.x1, E.inOut(seg(t, 1.15, 2.2)));
    const lines = [[1, 0, 2.6, 0.9], [0.62, 0.9, 1.3, 0.38], [1.28, -0.7, 1.1, 0.28]];
    for (const [amp, ph, w, a] of lines) {
      ctx.save(); ctx.strokeStyle = C.moon; ctx.globalAlpha *= a; ctx.lineWidth = w; ctx.beginPath();
      for (let x = WAVE.x0; x <= rev; x += 3) {
        const u = (x - WAVE.x0) / (WAVE.x1 - WAVE.x0), win = Math.sin(Math.PI * u) ** 1.4;
        // syllable-like modulation, drifting with time
        const m = 0.55 + 0.45 * Math.sin(u * 9.0 + t * 3.1 + ph);
        const y = WAVE.y + A * amp * win * m * Math.sin(u * TAU * 6.5 - t * 7 + ph);
        if (x === WAVE.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    }
    if (rev < WAVE.x1) K.nib(ctx, rev, WAVE.y, grow, 5);
  }

  const ART = [
    { key: 'l2-ochre', tone: 'ochre', seed: 21, pts: [[1540, -40], [1960, -40], [1960, 300], [1830, 262], [1700, 150], [1596, 96]], torn: [false, false, true, true, true, true], sketch: 'compass', sx: 1800, sy: 70, dim: 0.14, lit: 1 },
    { key: 'l2-zebra', tone: 'zebra', seed: 22, pts: [[-40, 640], [96, 612], [140, 930], [-40, 968]], torn: [true, true, true, false], sketch: 'none', dim: 0.3, stripe: -0.45 },
  ];

  K.loop(2, DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.2) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    // browser body
    K.shadow(ctx, env, () => { K.rr(ctx, BR.x, BR.y, BR.w, BR.h, BR.r); ctx.fillStyle = '#0B0C10'; ctx.fill(); }, { blur: 70, y: 30, color: 'rgba(0,0,0,0.7)' });
    let g = ctx.createRadialGradient(960, 420, 0, 960, 420, 760);
    g.addColorStop(0, 'rgba(250,249,245,0.045)'); g.addColorStop(1, 'rgba(250,249,245,0)');
    K.rr(ctx, BR.x, BR.y, BR.w, BR.h, BR.r); ctx.fillStyle = g; ctx.fill();
    // pencil + ink
    for (const s of S) {
      K.ink(ctx, s.pts, { w: Math.max(1.2, s.w * 0.6), alpha: pencilA * (s.a > 0.5 ? 1 : 0.7) });
      const a = E.inOut(seg(t, s.t0, s.t1)), b = E.inOut(seg(t, s.e0, s.e1));
      if (a > b) {
        K.ink(ctx, s.pts, { from: b, to: a, w: s.w, alpha: s.a });
        if (s.nib && a < 1) { const [x, y] = P.at(s.pts, a); K.nib(ctx, x, y, 1, 4.5); }
      }
    }
    // browser chrome details: dots, lock, url bars (pop with the ink)
    const ink = K.env(t, 0.5, 0.9, 8.3, 8.9);
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(BR.x + 34 + k * 26, BR.y + 31, 6.5, 0, TAU); ctx.strokeStyle = `rgba(244,241,234,${0.14 + 0.56 * ink})`; ctx.lineWidth = 1.8; ctx.stroke(); }
    ctx.save(); ctx.globalAlpha *= 0.14 + 0.5 * ink; ctx.strokeStyle = C.moon; ctx.lineWidth = 1.6;
    const lx = pill.x + 22, ly = pill.y + 16;
    ctx.beginPath(); ctx.roundRect(lx - 6, ly - 2, 12, 9, 2); ctx.stroke(); ctx.beginPath(); ctx.arc(lx, ly - 3, 4, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = C.moon; ctx.globalAlpha *= 0.6; K.rr(ctx, lx + 18, ly - 3, 150, 6, 3); ctx.fill(); K.rr(ctx, lx + 176, ly - 3, 52, 6, 3); ctx.fill();
    ctx.restore();
    // social dots in the footer
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(BR.x + BR.w - 150 + k * 40, FOOT_Y + 68, 9, 0, TAU); ctx.strokeStyle = `rgba(244,241,234,${0.12 + 0.36 * K.env(t, 1.3 + k * 0.06, 1.6 + k * 0.06, 8.5, 9.0)})`; ctx.lineWidth = 1.6; ctx.stroke(); }
    // Firecrawl pulls the brand from the URL while the site builds: its chip sits in the address bar, a read shimmer
    // crosses the URL, then the palette and the logo fly into the page (the clay swatch becomes the call-to-action)
    const chipA = K.env(t, 0.45, 0.75, 8.25, 8.75), ch = 15, cw = 172 * ch / 40, cx = pill.x + pill.w - cw - 16, cy = pill.y + pill.h / 2;
    if (chipA > 0) {
      K.glow(ctx, cx + 8, cy, 44, '#FA5D19', 0.16 * chipA * (0.6 + 0.4 * K.env(t, 0.7, 0.8, 1.1, 1.4)));
      K.firecrawl(ctx, cx, cy - ch / 2, ch, { alpha: chipA });
    }
    const sh = seg(t, 0.55, 1.0);
    if (sh > 0 && sh < 1) {
      ctx.save(); K.rr(ctx, pill.x, pill.y, pill.w, pill.h, 16); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
      const x = lerp(pill.x - 60, cx, E.inOut(sh)), g2 = ctx.createLinearGradient(x - 50, 0, x + 50, 0);
      g2.addColorStop(0, 'rgba(255,190,150,0)'); g2.addColorStop(0.5, 'rgba(255,190,150,0.28)'); g2.addColorStop(1, 'rgba(255,190,150,0)');
      ctx.fillStyle = g2; ctx.fillRect(x - 50, pill.y, 100, pill.h); ctx.restore();
    }
    const NAVLOGO = [BR.x + 58, BR.y + BAR + 44];
    const PULL = [[C.clay, [960, HEAD.y + 150], 0.83], [C.moon, [960, HEAD.y - 40], 0.9], ['#DFA83F', [BR.x + BR.w - 380, BR.y + BAR + 44], 0.97], ['logo', NAVLOGO, 0.9]];
    for (const [col, to, t0] of PULL) {
      const u = seg(t, t0, t0 + 0.44); if (u <= 0 || u >= 1) continue;
      const from = [cx + 10, cy + 10], q = E.inOut(u), mid = [lerp(from[0], to[0], 0.5), Math.min(from[1], to[1]) + (to[1] > from[1] ? 60 : -40)];
      const path = P.bez(from, [from[0], mid[1]], [to[0], mid[1]], to, 24), [x, y] = P.at(path, q);
      K.dots(ctx, path, { from: Math.max(0, q - 0.25), to: q, gap: 9, r: 1.4, alpha: 0.35 });
      if (col === 'logo') { ctx.save(); ctx.globalAlpha *= 0.9; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, TAU); ctx.fill(); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(x, y, 7.5 * (1 - 0.35 * K.smooth(seg(u, 0.75, 1))), 0, TAU); ctx.fillStyle = col; ctx.fill(); }
    }
    // the site's logo, pulled in, now sits in the nav
    const logoA = K.env(t, 1.3, 1.36, 8.3, 8.8);
    if (logoA > 0) {
      const [x, y] = NAVLOGO; ctx.save(); ctx.globalAlpha *= logoA;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(244,241,234,0.5)'; K.rr(ctx, x + 22, y - 3.5, 70, 7, 3.5); ctx.fill();
      ctx.restore();
    }
    // the clay call-to-action
    const bt = E.outBack(seg(t, 1.25, 1.75), 1.6) * (1 - E.inOut(seg(t, 8.55, 8.95)));
    if (bt > 0.01) {
      ctx.save(); ctx.translate(960, HEAD.y + 150); ctx.scale(bt, bt);
      K.rr(ctx, -100, -28, 200, 56, 28); ctx.fillStyle = C.clay; ctx.fill();
      ctx.strokeStyle = C.ivory; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.stroke(); K.arrow(ctx, 17, 0, 0, { size: 9, w: 2.6, color: C.ivory });
      ctx.restore();
    }

    // voice wave -> birds -> letters
    wave(ctx, t);
    const lay = layout(ctx), base = HEAD.y, midY = base - HEAD.size * 0.3;
    for (const L of letters) {
      const j = L.j, a = E.out(seg(t, landT(j), landT(j) + 0.32)) * (1 - E.inOut(seg(t, exitT(j), exitT(j) + 0.22)));
      if (a > 0) K.serif(ctx, L.ch, L.x, base + 10 * (1 - E.out(seg(t, landT(j), landT(j) + 0.45))), HEAD.size, { color: C.moon, alpha: a });
      // arriving bird
      const s0 = spawnT(j), s1 = landT(j);
      if (t > s0 && t < s1 + 0.3) {
        const u = E.inOut(seg(t, s0, s1)), px = peakX(j), py = WAVE.y - 18;
        const q = P.at(P.bez([px, py], [px + 40 + 50 * K.hash(j, 3), py - 250 - 70 * K.hash(j, 4)], [L.cx - 120 + 60 * K.hash(j, 5), midY - 230], [L.cx, midY], 24), u);
        const sz = lerp(10, 22, Math.sin(Math.PI * Math.min(1, u * 1.1))) * (1 - E.inOut(seg(t, s1, s1 + 0.28)));
        bird(ctx, q[0], q[1], sz, t * 17 + j * 1.7, q[2] * 0.12, K.smooth(seg(t, s0, s0 + 0.2)) * (1 - E.inOut(seg(t, s1 - 0.05, s1 + 0.26))));
      }
      // departing bird
      const e0 = exitT(j);
      if (t > e0 && t < e0 + 1.9) {
        const u = E.in(seg(t, e0, e0 + 1.8)), tx = 2080 + 60 * K.hash(j, 7), ty = -120 - 160 * K.hash(j, 8);
        const q = P.at(P.bez([L.cx, midY], [L.cx + 60, midY - 160 - 60 * K.hash(j, 9)], [tx - 380, ty + 260], [tx, ty], 24), u);
        const sz = lerp(8, 24, E.out(seg(t, e0, e0 + 0.5)));
        bird(ctx, q[0], q[1], sz, t * 15 + j * 2.1, q[2] * 0.15, E.out(seg(t, e0, e0 + 0.25)));
      }
    }
    // caret: follows the typing, blinks while the headline holds
    const shown = letters.filter(L => t >= landT(L.j) && t < exitT(L.j));
    const caretA = K.env(t, 4.0, 4.15, 7.15, 7.35) * (t > 5.2 && t < 7.0 ? 0.5 + 0.5 * Math.cos(TAU * (t - 5.2) / 0.9) : 1);
    if (caretA > 0) {
      const lastL = shown.length ? shown[shown.length - 1] : letters[0];
      const cx = shown.length ? lastL.x + lastL.w + 10 : lay.x0 - 8;
      ctx.fillStyle = K.rgba(C.clay, caretA); ctx.fillRect(cx, base - HEAD.size * 0.74, 4, HEAD.size * 0.86);
    }
    // footer wordmark: writes itself with a nib, drifts, lifts off
    const w0 = E.inOut(seg(t, 5.2, 6.95)), w1 = E.inOut(seg(t, 8.45, 9.5));
    if (w0 > w1) {
      ctx.save(); ctx.translate(24 - 48 * E.sine(seg(t, 5.2, 9.6)), 0);
      ctx.beginPath(); ctx.rect(BR.x + 2, FOOT_Y + 2, BR.w - 4, BR.h - (FOOT_Y - BR.y) - 4); ctx.clip();
      K.ribbon(ctx, SIG, { from: w1, to: w0, wf: sigW, alpha: 0.94 });
      if (w0 < 1) { const [x, y] = P.at(SIG, w0); K.nib(ctx, x, y, 1, 4.5); }
      ctx.restore();
    }
  });
})();
