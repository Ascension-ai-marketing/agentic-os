/* Level 7 · At scale · "×100"
 * set-up : a list of URLs scrolls past the scan line (Firecrawl, logo on the scanner head) that reads each one
 * turn   : the list speeds up; tiles pop into a 10x10 grid in a diagonal wave, each a different brand colour
 * pay-off: ×100 counts up with the grid and holds; the wave clears and the list slows back to reading pace */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10;
  const LIST = { x: 290, y: 316, w: 574, h: 614, r: 18 }, HEADER = 54, RH = 50;
  const SCAN = LIST.y + HEADER + (LIST.h - HEADER) * 0.5;
  const G = { x: 1016, y: 316, n: 10, s: 54, gap: 7.8 };
  const NL = 112;                                   // list period in rows (the scroll covers exactly one period per loop)
  const V0 = 1.1, HUMP = NL - V0 * DUR;              // rows per second at reading pace; rows covered by the rush

  // scroll position in rows: reading pace + one smooth rush while the grid fills
  const rush = t => E.inOut(seg(t, 3.85, 7.05));
  const scroll = t => V0 * t + HUMP * rush(t);
  const speed = t => V0 + HUMP * (rush(t + 0.01) - rush(t - 0.01)) / 0.02;

  // ---- 100 brand colours: curated, muted, warm-leaning; never the rival blue; neighbours differ in hue and value
  const TILES = (() => {
    const r = K.rng(7007);
    const HUES = [4, 12, 20, 28, 36, 44, 52, 62, 78, 96, 118, 140, 158, 170, 180, 272, 292, 312, 330, 346];
    const NEUTRAL = ['#1B1A17', '#F1EEE5', '#D8CBB0', '#2A2B30', '#EFE3C8', '#A39E93', '#3B2A20', '#E6DFD0', '#4A4A48', '#C9B99A'];
    const out = [];
    for (let i = 0; i < 100; i++) {
      const row = Math.floor(i / 10), col = i % 10;
      let fill, lum;
      if ((i * 7 + 3) % 10 === 0) { fill = NEUTRAL[(i * 3) % NEUTRAL.length]; const c = K.rgb(fill); lum = (c[0] + c[1] + c[2]) / 765 > 0.55; }
      else {
        const h = HUES[(row * 7 + col * 3 + (row % 3)) % HUES.length] + (r() - 0.5) * 8;
        const warm = h < 70 || h > 320, sat = warm ? 36 + r() * 20 : 22 + r() * 18;
        const l = [36, 52, 64, 44, 58][(row + col * 2) % 5] + (r() - 0.5) * 8;
        fill = `hsl(${h.toFixed(0)},${sat.toFixed(0)}%,${l.toFixed(0)}%)`; lum = l > 55;
      }
      out.push({ fill, mark: lum ? 'rgba(20,20,19,0.78)' : 'rgba(250,249,245,0.86)', glyph: Math.floor(r() * 8), jit: (r() - 0.5) * 0.06 });
    }
    return out;
  })();
  const cellOf = i => ({ r: Math.floor(i / G.n), c: i % G.n });
  // the loop opens on the full grid: the wave clears it (1.45-3.2), the list reads, the rush refills it (4.2-6.9)
  const popT = i => { const { r, c } = cellOf(i); return 4.2 + (r + c) * 0.128 + TILES[i].jit; };
  const outT = i => { const { r, c } = cellOf(i); return 1.45 + (r + c) * 0.074; };
  const tileState = (i, t) => {
    let s;
    if (t < outT(i)) s = 1;
    else if (t < popT(i)) s = 1 - E.in(seg(t, outT(i), outT(i) + 0.36));
    else s = E.outBack(seg(t, popT(i), popT(i) + 0.42), 1.7);
    return { s, flash: K.env(t, popT(i), popT(i) + 0.05, popT(i) + 0.08, popT(i) + 0.45), on: s >= 0.5 };
  };
  function glyph(ctx, k, x, y, s, col) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = s * 0.18; ctx.beginPath();
    switch (k) {
      case 0: ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.fill(); break;
      case 1: ctx.arc(0, 0, s * 0.42, 0, TAU); ctx.stroke(); break;
      case 2: ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.5, s * 0.4); ctx.lineTo(-s * 0.5, s * 0.4); ctx.closePath(); ctx.fill(); break;
      case 3: ctx.roundRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.84, s * 0.12); ctx.fill(); break;
      case 4: ctx.moveTo(0, -s * 0.55); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 0.55); ctx.lineTo(-s * 0.5, 0); ctx.closePath(); ctx.fill(); break;
      case 5: ctx.arc(-s * 0.22, 0, s * 0.26, 0, TAU); ctx.arc(s * 0.3, 0, s * 0.26, 0, TAU); ctx.fill(); break;
      case 6: ctx.arc(0, s * 0.18, s * 0.5, Math.PI, 0); ctx.fill(); break;
      default: ctx.fillRect(-s * 0.5, -s * 0.12, s, s * 0.24); ctx.fillRect(-s * 0.12, -s * 0.5, s * 0.24, s); break;
    }
    ctx.restore();
  }

  // ---- list rows (greeked URLs: favicon, protocol, name, dot, tld)
  const ROW = k => { const m = ((k % NL) + NL) % NL; return { col: TILES[(m * 29) % 100].fill, name: 90 + K.hash(m, 3) * 150, tld: 26 + K.hash(m, 4) * 22, pre: K.hash(m, 5) > 0.5 }; };
  function list(ctx, env, t) {
    K.shadow(ctx, env, () => { K.rr(ctx, LIST.x, LIST.y, LIST.w, LIST.h, LIST.r); ctx.fillStyle = '#0B0C10'; ctx.fill(); }, { blur: 60, y: 26, color: 'rgba(0,0,0,0.7)' });
    // header: three dots + a greeked file tab
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(LIST.x + 28 + k * 22, LIST.y + HEADER / 2, 5.5, 0, TAU); ctx.strokeStyle = 'rgba(244,241,234,0.55)'; ctx.lineWidth = 1.6; ctx.stroke(); }
    K.rr(ctx, LIST.x + 110, LIST.y + HEADER / 2 - 5, 120, 10, 5); ctx.fillStyle = 'rgba(244,241,234,0.22)'; ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.12)'; ctx.fillRect(LIST.x + 1, LIST.y + HEADER, LIST.w - 2, 1.2);
    // rows
    const S = scroll(t), v = speed(t), smear = Math.min(RH * 1.6, v * RH / 30);   // motion blur length per frame
    ctx.save(); ctx.beginPath(); ctx.rect(LIST.x + 1, LIST.y + HEADER + 2, LIST.w - 2, LIST.h - HEADER - 4); ctx.clip();
    const k0 = Math.floor(S) - 7, k1 = Math.ceil(S) + 7;
    for (let k = k0; k <= k1; k++) {
      const y = SCAN + (k - S) * RH; if (y < LIST.y + HEADER - RH || y > LIST.y + LIST.h + RH) continue;
      const R = ROW(k), hl = Math.max(0, 1 - Math.abs(y - SCAN) / (RH * 0.6)) * (smear < 20 ? 1 : 0.3);
      const blurA = 8 / (8 + smear) * (1 - 0.45 * Math.min(1, smear / 60)), x0 = LIST.x + 34;
      // favicon
      ctx.globalAlpha = 0.85 * (0.5 + 0.5 * blurA) + 0.15 * hl; ctx.fillStyle = R.col;
      ctx.beginPath(); ctx.roundRect(x0, y - 11 - smear / 2, 22, 22 + smear, 11); ctx.fill();
      // bars
      let x = x0 + 40; const bar = (w, a) => { ctx.globalAlpha = a * blurA; ctx.fillStyle = C.moon; ctx.beginPath(); ctx.roundRect(x, y - 4.5 - smear / 2, w, 9 + smear, 4.5); ctx.fill(); x += w + 10; };
      if (R.pre) bar(46, 0.16 + 0.2 * hl);
      bar(R.name, 0.42 + 0.5 * hl);
      ctx.globalAlpha = (0.4 + 0.5 * hl) * blurA; ctx.beginPath(); ctx.arc(x - 4, y + 2, 2.4, 0, TAU); ctx.fill(); x += 6;
      bar(R.tld, 0.26 + 0.4 * hl);
      if (hl > 0.05) K.glow(ctx, x0 + 11, y, 34, R.col.startsWith('hsl') ? '#FFD7B5' : '#FFD7B5', 0.25 * hl);
    }
    ctx.globalAlpha = 1;
    // fade rows into the top and bottom edges of the panel
    for (const [y0, y1] of [[LIST.y + HEADER, LIST.y + HEADER + 90], [LIST.y + LIST.h, LIST.y + LIST.h - 90]]) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(11,12,16,1)'); g.addColorStop(1, 'rgba(11,12,16,0)'); ctx.fillStyle = g; ctx.fillRect(LIST.x, Math.min(y0, y1), LIST.w, 90); }
    ctx.restore();
    // the scan line is Firecrawl: a small tab carrying the real wordmark at the scanner head
    const x0 = LIST.x + 10, x1 = LIST.x + LIST.w - 10, rushA = Math.min(1, (v - V0) / 30);
    let g = ctx.createLinearGradient(0, SCAN - 26, 0, SCAN + 26); g.addColorStop(0, 'rgba(217,119,87,0)'); g.addColorStop(0.5, 'rgba(217,119,87,0.16)'); g.addColorStop(1, 'rgba(217,119,87,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, SCAN - 26, x1 - x0, 52);
    ctx.fillStyle = C.clay; ctx.fillRect(x0 - 12, SCAN - 1.2, x1 - x0 + 12, 2.4);
    ctx.beginPath(); ctx.moveTo(x1 + 2, SCAN - 8); ctx.lineTo(x1 - 8, SCAN); ctx.lineTo(x1 + 2, SCAN + 8); ctx.closePath(); ctx.fill();
    const lh = 21, lw = 172 * lh / 40, tw = lw + 30, th = 40, tx = LIST.x - tw + 6, ty = SCAN - th / 2;
    K.glow(ctx, tx + 18, SCAN, 70, '#FA5D19', 0.10 + 0.14 * rushA);
    K.shadow(ctx, env, () => { K.rr(ctx, tx, ty, tw, th, th / 2); ctx.fillStyle = '#0B0C10'; ctx.fill(); }, { blur: 18, y: 6, color: 'rgba(0,0,0,0.6)' });
    K.rr(ctx, tx, ty, tw, th, th / 2); ctx.strokeStyle = 'rgba(244,241,234,0.34)'; ctx.lineWidth = 1.3; ctx.stroke();
    K.firecrawl(ctx, tx + 15, SCAN - lh / 2, lh);
    // frame line
    K.rr(ctx, LIST.x, LIST.y, LIST.w, LIST.h, LIST.r); ctx.strokeStyle = 'rgba(244,241,234,0.85)'; ctx.lineWidth = 2.2; ctx.stroke();
  }

  // ---- packets from the scan line to the grid while the rush is on
  const LINK = P.bez([LIST.x + LIST.w + 10, SCAN], [LIST.x + LIST.w + 70, SCAN], [G.x - 70, SCAN - 40], [G.x - 14, SCAN - 40], 40);
  function link(ctx, t) {
    const a = K.env(t, 3.8, 4.2, 6.6, 7.2); if (a <= 0) return;
    K.dots(ctx, LINK, { gap: 12, r: 1.8, alpha: 0.35 * a, off: t * 40 });
    for (let k = 0; k < 6; k++) { const f = K.wrap(t * 1.6 + k / 6); const [x, y] = P.at(LINK, f); K.nib(ctx, x, y, a * Math.sin(Math.PI * f), 3.2); }
  }

  const ART = [
    { key: 'l7-ochre', tone: 'ochre', seed: 71, pts: [[1660, -40], [1960, -40], [1960, 236], [1840, 216], [1716, 132]], torn: [false, false, true, true, true], sketch: 'compass', sx: 1850, sy: 60, dim: 0.14, lit: 1 },
    { key: 'l7-zebra', tone: 'zebra', seed: 72, pts: [[-40, 880], [170, 900], [196, 1120], [-40, 1120]], torn: [true, true, false, false], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop(7, DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.1) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    list(ctx, env, t);
    link(ctx, t);
    // grid slots
    ctx.save(); ctx.strokeStyle = 'rgba(244,241,234,0.09)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 100; i++) { const { r, c } = cellOf(i); K.rr(ctx, G.x + c * (G.s + G.gap), G.y + r * (G.s + G.gap), G.s, G.s, 9); ctx.stroke(); }
    ctx.restore();
    // tiles
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const st = tileState(i, t); if (st.on) n++;
      if (st.s <= 0.001) continue;
      const { r, c } = cellOf(i), T = TILES[i], cx = G.x + c * (G.s + G.gap) + G.s / 2, cy = G.y + r * (G.s + G.gap) + G.s / 2, hs = G.s / 2 * st.s;
      K.rr(ctx, cx - hs, cy - hs, hs * 2, hs * 2, 9 * st.s); ctx.fillStyle = T.fill; ctx.fill();
      const sh = ctx.createLinearGradient(0, cy - hs, 0, cy + hs); sh.addColorStop(0, 'rgba(255,250,240,0.10)'); sh.addColorStop(0.5, 'rgba(255,250,240,0)'); sh.addColorStop(1, 'rgba(20,14,8,0.16)');
      ctx.fillStyle = sh; ctx.fill();
      glyph(ctx, T.glyph, cx, cy, 22 * st.s, T.mark);
      if (st.flash > 0) { ctx.save(); ctx.globalAlpha = 0.55 * st.flash; K.rr(ctx, cx - hs, cy - hs, hs * 2, hs * 2, 9 * st.s); ctx.fillStyle = '#FFF4EA'; ctx.fill(); ctx.restore(); }
    }
    // ×100: holds while the grid is full, fades as the wave clears it, counts up with the refill
    const exiting = t < 3.6, a = exiting ? K.smooth(seg(n, 25, 92)) : K.smooth(seg(n, 0, 3)), num = exiting ? 100 : n;
    if (a > 0) {
      const size = 118, fullW = K.serifW(ctx, '×100', size), x0 = 960 - fullW / 2, y = 232;
      const xw = K.serifW(ctx, '×', size) + size * 0.02;
      K.serif(ctx, '×', x0, y, size, { color: C.moon, alpha: a });
      K.serif(ctx, String(num), x0 + xw, y, size, { color: C.clay, alpha: a });
    }
  });
})();
