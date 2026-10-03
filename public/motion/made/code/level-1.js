/* Level 1 · Presentations · "Slides that move"
 * set-up : an ivory slide on the dark screen; the chart builds bar by bar, its trend line drawing itself
 * turn   : the slide glides into a PowerPoint-like window drawn in ink, where the same loop plays again
 * pay-off: the camera pushes back into the slide; the chart settles to its baseline; back to the start */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg;
  const DUR = 10;
  const SW = 1152, SH = 648;                                   // slide, design px at full size
  const FULL = { x: 960, y: 524, s: 1.1 };
  const WIN = { x: 306, y: 144, w: 1308, h: 816 };
  const RAIL = 190, TOP = 112, FOOT = 40;
  const CAN = { x: WIN.x + RAIL, y: WIN.y + TOP, w: WIN.w - RAIL, h: WIN.h - TOP - FOOT };
  const INW = { x: CAN.x + CAN.w / 2, y: CAN.y + CAN.h / 2, s: 0.7 };
  const Z1 = FULL.s / INW.s;                                   // camera zoom that returns the slide to full size
  const FIX = { x: INW.x - (FULL.x - INW.x) / (Z1 - 1), y: INW.y - (FULL.y - INW.y) / (Z1 - 1) };
  const BARS = [0.30, 0.45, 0.38, 0.58, 0.72, 0.95];
  const CH = { x0: 104, x1: 1048, top: 250, base: 560, bw: 88 };
  const slot = (CH.x1 - CH.x0) / BARS.length, bx = i => CH.x0 + slot * (i + 0.5);
  const SWP = [[-0.55, 2.0], [5.15, 6.6]];                     // build cadence; build 1 straddles the loop point
  const passT = (i, s) => s[0] + (bx(i) - (CH.x0 - 40)) / (CH.x1 - CH.x0 + 80) * (s[1] - s[0]);

  // ---- chart state: bar heights (0..1), how far each trend-line segment has drawn, line visibility
  // (no travelling beam: the bars rise in a left-to-right cadence and the line follows the tops)
  const segsFor = (tt, sw) => BARS.slice(1).map((_, i) => E.inOut(seg(tt, passT(i + 1, sw) + 0.05, passT(i + 1, sw) + 0.6)));
  function chart(t) {
    let h, segs = BARS.slice(1).map(() => 1), lineA = 1;
    if (t >= 9.0 || t < 4.6) { const tt = t >= 9.0 ? t - DUR : t; h = BARS.map((_, i) => E.out(seg(tt, passT(i, SWP[0]), passT(i, SWP[0]) + 0.85))); segs = segsFor(tt, SWP[0]); }
    else if (t < 5.15) { h = BARS.map((_, i) => 1 - E.inOut(seg(t, 4.6 + i * 0.03, 4.9 + i * 0.03))); lineA = 1 - E.inOut(seg(t, 4.6, 4.85)); }
    else if (t < 7.95) { h = BARS.map((_, i) => E.out(seg(t, passT(i, SWP[1]), passT(i, SWP[1]) + 0.75))); segs = segsFor(t, SWP[1]); }
    else { h = BARS.map((_, i) => 1 - E.inOut(seg(t, 8.0 + i * 0.06, 8.55 + i * 0.06))); lineA = 1 - E.inOut(seg(t, 8.0, 8.4)); }
    return { h, segs, lineA };
  }

  // ---- the slide, drawn in its own 1152x648 space
  function slide(ctx, env, st, o = {}) {
    // paper
    K.rr(ctx, 0, 0, SW, SH, 12);
    ctx.fillStyle = K.paper(ctx, C.ivory, 3); ctx.fill();
    let g = ctx.createLinearGradient(0, 0, SW * 0.4, SH * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(60,48,32,0.07)');
    ctx.fillStyle = g; ctx.fill();
    if (o.tiny) return tinyContent(ctx, st);
    // eyebrow rule + title
    ctx.fillStyle = C.clay; ctx.fillRect(CH.x0, 94, 46, 4);
    K.serif(ctx, 'Slides that move', CH.x0 - 3, 170, 64, { color: C.ink });
    K.sans(ctx, '01', SW - 64, SH - 40, 15, { color: C.ink3, weight: 500, track: 0.12, align: 'right' });
    // grid + baseline
    ctx.strokeStyle = 'rgba(20,20,19,0.08)'; ctx.lineWidth = 1.2;
    for (let k = 1; k <= 3; k++) { const y = CH.base - k * 92; ctx.beginPath(); ctx.moveTo(CH.x0, y); ctx.lineTo(CH.x1, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(20,20,19,0.34)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(CH.x0, CH.base); ctx.lineTo(CH.x1, CH.base); ctx.stroke();
    const H = CH.base - CH.top;
    // bars
    st.h.forEach((v, i) => {
      if (v <= 0.002) return;
      const hh = H * BARS[i] * v, x = bx(i) - CH.bw / 2;
      ctx.beginPath(); ctx.roundRect(x, CH.base - hh, CH.bw, hh, [7, 7, 0, 0]);
      ctx.fillStyle = i === BARS.length - 1 ? C.clay : 'rgba(20,20,19,0.88)'; ctx.fill();
    });
    // trend line through the tops, drawing itself segment by segment as each bar rises
    const pts = st.h.map((v, i) => [bx(i), CH.base - H * BARS[i] * v - 26]);
    if (st.lineA > 0) {
      ctx.save(); ctx.globalAlpha *= st.lineA; ctx.strokeStyle = 'rgba(20,20,19,0.8)'; ctx.lineWidth = 2.2; ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < st.segs.length; i++) {
        const f = st.segs[i]; if (f <= 0) break;
        ctx.lineTo(lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)); if (f < 1) break;
      }
      ctx.stroke();
      // points
      pts.forEach(([x, y], i) => {
        const a = K.smooth(seg(st.h[i], 0.35, 0.75)); if (a <= 0) return;
        const last = i === pts.length - 1;
        ctx.beginPath(); ctx.arc(x, y, (last ? 7 : 5.5) * (0.6 + 0.4 * a), 0, K.TAU);
        ctx.fillStyle = last ? C.clay : C.ivory; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = last ? C.clay : 'rgba(20,20,19,0.85)'; ctx.stroke();
        if (last) { ctx.beginPath(); ctx.arc(x, y, 7 + 10 * a, 0, K.TAU); ctx.strokeStyle = `rgba(217,119,87,${0.28 * a})`; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
      ctx.restore();
    }
  }
  // thumbnail: the same slide, reduced to strokes that stay crisp at 1/10 scale
  function tinyContent(ctx, st) {
    ctx.fillStyle = C.clay; ctx.fillRect(CH.x0, 94, 60, 8);
    ctx.fillStyle = 'rgba(20,20,19,0.8)'; ctx.fillRect(CH.x0, 128, 560, 38);
    const H = CH.base - CH.top;
    st.h.forEach((v, i) => { if (v <= 0.01) return; const hh = H * BARS[i] * v; ctx.fillStyle = i === BARS.length - 1 ? C.clay : 'rgba(20,20,19,0.85)'; ctx.fillRect(bx(i) - CH.bw / 2, CH.base - hh, CH.bw, hh); });
    ctx.fillStyle = 'rgba(20,20,19,0.3)'; ctx.fillRect(CH.x0, CH.base, CH.x1 - CH.x0, 5);
  }

  // ---- PowerPoint-like window, in ink
  const RIB = [                                                  // ribbon glyphs: [x offset, kind]
    [40, 'newslide'], [84, 'layout'], [150, 'text'], [194, 'align'], [260, 'shape'], [304, 'chart'], [348, 'image'], [414, 'path'], [458, 'play'],
  ];
  const SEPS = [120, 230, 386];
  function glyph(ctx, kind, x, y, col, a) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= a; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8;
    const r = (x0, y0, w, h, rr = 3) => { ctx.beginPath(); ctx.roundRect(x0, y0, w, h, rr); ctx.stroke(); };
    switch (kind) {
      case 'newslide': r(-12, -9, 24, 17); ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke(); break;
      case 'layout': r(-12, -9, 24, 17); ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(12, -3); ctx.moveTo(-1, -3); ctx.lineTo(-1, 8); ctx.stroke(); break;
      case 'text': ctx.beginPath(); for (let k = 0; k < 3; k++) { ctx.moveTo(-11, -7 + k * 7); ctx.lineTo(k === 2 ? 3 : 11, -7 + k * 7); } ctx.stroke(); break;
      case 'align': ctx.beginPath(); for (let k = 0; k < 3; k++) { const w = [22, 14, 18][k]; ctx.moveTo(-w / 2, -7 + k * 7); ctx.lineTo(w / 2, -7 + k * 7); } ctx.stroke(); break;
      case 'shape': ctx.beginPath(); ctx.arc(-4, -1, 7, 0, K.TAU); ctx.stroke(); r(0, -3, 12, 12, 2); break;
      case 'chart': ctx.beginPath(); ctx.moveTo(-11, 9); ctx.lineTo(11, 9); ctx.stroke(); ctx.fillRect(-8, 1, 4, 8); ctx.fillRect(-2, -4, 4, 13); ctx.fillRect(4, -8, 4, 17); break;
      case 'image': r(-12, -9, 24, 18); ctx.beginPath(); ctx.moveTo(-9, 6); ctx.lineTo(-3, -1); ctx.lineTo(2, 4); ctx.lineTo(5, 1); ctx.lineTo(9, 6); ctx.stroke(); break;
      case 'path': ctx.beginPath(); ctx.moveTo(-11, 7); ctx.bezierCurveTo(-6, -12, 4, 12, 10, -6); ctx.setLineDash([2.5, 3.5]); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(10, -6, 3, 0, K.TAU); ctx.fill(); break;
      case 'play': ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(9, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.stroke(); break;
    }
    ctx.restore();
  }
  const winOutline = P.wob(P.rrect(WIN.x, WIN.y, WIN.w, WIN.h, 20, 5), 0.9, 11, 80);
  const lines = [
    { pts: P.wob(P.line(WIN.x + 6, WIN.y + 50, WIN.x + WIN.w - 6, WIN.y + 50), 0.6, 12), a: 0.35 },
    { pts: P.wob(P.line(WIN.x + 6, WIN.y + TOP, WIN.x + WIN.w - 6, WIN.y + TOP), 0.6, 13), a: 0.35 },
    { pts: P.wob(P.line(WIN.x + RAIL, WIN.y + TOP, WIN.x + RAIL, WIN.y + WIN.h - FOOT), 0.6, 14), a: 0.3 },
    { pts: P.wob(P.line(WIN.x + 6, WIN.y + WIN.h - FOOT, WIN.x + WIN.w - 6, WIN.y + WIN.h - FOOT), 0.6, 15), a: 0.3 },
  ];
  function windowChrome(ctx, env, t, st) {
    const draw = seg(t, 3.1, 4.0), a = 1 - E.inOut(seg(t, 7.95, 8.9));
    if (draw <= 0 || a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    // fill
    const fa = E.inOut(seg(t, 3.3, 4.2));
    K.rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, 20); ctx.fillStyle = `rgba(13,14,19,${0.92 * fa})`; ctx.fill();
    ctx.fillStyle = `rgba(250,249,245,${0.025 * fa})`; ctx.fillRect(CAN.x + 1, CAN.y + 1, CAN.w - 2, CAN.h - 2);
    // outline draws on with a nib
    const f = E.inOut(draw);
    K.ink(ctx, winOutline, { to: f, w: 2.4, alpha: 0.9 });
    if (f < 1) { const [x, y] = P.at(winOutline, f); K.nib(ctx, x, y, 1, 4.5); }
    lines.forEach((l, i) => K.ink(ctx, l.pts, { to: E.inOut(seg(t, 3.45 + i * 0.1, 4.15 + i * 0.1)), w: 1.6, alpha: l.a * 2 }));
    // title bar: three dots + title pill
    for (let k = 0; k < 3; k++) {
      const s = E.out(seg(t, 3.5 + k * 0.06, 3.9 + k * 0.06)); if (s <= 0) continue;
      ctx.beginPath(); ctx.arc(WIN.x + 30 + k * 24, WIN.y + 25, 6.5 * s, 0, K.TAU); ctx.strokeStyle = 'rgba(244,241,234,0.7)'; ctx.lineWidth = 1.8; ctx.stroke();
    }
    const tp = E.out(seg(t, 3.7, 4.2));
    if (tp > 0) { K.rr(ctx, WIN.x + WIN.w / 2 - 130 * tp, WIN.y + 19, 260 * tp, 12, 6); ctx.fillStyle = 'rgba(244,241,234,0.14)'; ctx.fill(); }
    // ribbon
    const playing = K.env(t, 5.0, 5.2, 6.6, 6.9);
    RIB.forEach(([dx, kind], i) => {
      const s = E.out(seg(t, 3.75 + i * 0.05, 4.2 + i * 0.05)); if (s <= 0) return;
      const x = WIN.x + dx + 10, y = WIN.y + 80;
      if (kind === 'play' && playing > 0) { K.glow(ctx, x + 1, y, 26, C.clay, 0.35 * playing); }
      glyph(ctx, kind, x, y, kind === 'play' ? K.mix('#F4F1EA', C.clay, playing) : C.moon, 0.72 * s);
    });
    SEPS.forEach((dx, i) => { const s = seg(t, 3.9 + i * 0.05, 4.2 + i * 0.05); if (s <= 0) return; ctx.fillStyle = 'rgba(244,241,234,0.18)'; ctx.fillRect(WIN.x + dx + 10, WIN.y + 68, 1.2, 24 * s); });
    // slide rail: thumbnails, the first one is this slide, live
    for (let k = 0; k < 5; k++) {
      const s = E.out(seg(t, 3.95 + k * 0.08, 4.45 + k * 0.08)); if (s <= 0) continue;
      const tw = 128, th = tw * 9 / 16, x = WIN.x + 46, y = WIN.y + TOP + 28 + k * 102;
      if (y + th > WIN.y + WIN.h - FOOT - 10) break;
      ctx.save(); ctx.globalAlpha *= s; ctx.translate(x + tw / 2, y + th / 2); ctx.scale(0.9 + 0.1 * s, 0.9 + 0.1 * s); ctx.translate(-tw / 2, -th / 2);
      K.sans(ctx, String(k + 1), -16, th / 2 + 5, 14, { color: C.moon, alpha: 0.45, track: 0, align: 'right' });
      if (k === 0) {
        ctx.save(); ctx.scale(tw / SW, th / SH); slide(ctx, env, st, { tiny: true }); ctx.restore();
        K.rr(ctx, -4, -4, tw + 8, th + 8, 7); ctx.strokeStyle = C.clay; ctx.lineWidth = 2; ctx.stroke();
      } else {
        K.rr(ctx, 0, 0, tw, th, 4); ctx.fillStyle = 'rgba(250,249,245,0.05)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,241,234,0.32)'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = 'rgba(244,241,234,0.22)'; ctx.fillRect(12, 12, 46 + (k * 17) % 30, 5); ctx.fillRect(12, 24, 70 - (k * 11) % 26, 3.5); ctx.fillRect(12, 32, 58, 3.5);
      }
      ctx.restore();
    }
    // status bar: page dots left, zoom slider right
    const sb = E.out(seg(t, 4.2, 4.7));
    if (sb > 0) {
      ctx.save(); ctx.globalAlpha *= sb;
      const y = WIN.y + WIN.h - FOOT / 2;
      ctx.fillStyle = 'rgba(244,241,234,0.3)'; ctx.fillRect(WIN.x + 26, y - 2, 60, 4); ctx.fillRect(WIN.x + 96, y - 2, 34, 4);
      const zx = WIN.x + WIN.w - 210; ctx.fillStyle = 'rgba(244,241,234,0.25)'; ctx.fillRect(zx, y - 1, 150, 2);
      ctx.beginPath(); ctx.arc(zx + 96, y, 6, 0, K.TAU); ctx.fillStyle = C.moon; ctx.globalAlpha *= 0.8; ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- art touches (screen space, drift gently with the loop)
  const ART = [
    { key: 'l1-ochre', tone: 'ochre', seed: 11, pts: [[-40, -40], [332, -40], [300, 112], [214, 196], [-40, 238]], torn: [false, true, true, true, false], sketch: 'compass', sx: 120, sy: 70, dim: 0.16 },
    { key: 'l1-zebra', tone: 'zebra', seed: 12, pts: [[1790, 820], [1960, 790], [1960, 1120], [1846, 1120]], torn: [true, false, false, true], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop(1, DUR, (ctx, t, env) => {
    const p = env.p;
    // art
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(K.TAU * p + i * 2) * 4, Math.cos(K.TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    const st = chart(t);
    // camera: identity until the push-in, then a pure zoom about FIX that returns the slide to full size
    const u = E.soft(seg(t, 7.9, 9.35)), z = Math.pow(Z1, u);
    ctx.save();
    ctx.translate(FIX.x, FIX.y); ctx.scale(z, z); ctx.translate(-FIX.x, -FIX.y);
    windowChrome(ctx, env, t, st);
    // the slide: full -> glides into the window's canvas -> stays there (camera does the rest)
    const g = E.inOut(seg(t, 3.0, 4.45));
    const s = FULL.s * Math.pow(INW.s / FULL.s, g), cx = lerp(FULL.x, INW.x, g), cy = lerp(FULL.y, INW.y, g) - Math.sin(Math.PI * g) * 26, rot = -0.018 * Math.sin(Math.PI * g);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-SW / 2, -SH / 2);
    K.shadow(ctx, env, () => { K.rr(ctx, 0, 0, SW, SH, 12); ctx.fillStyle = C.ivory; ctx.fill(); }, { blur: 80, y: 40, color: 'rgba(0,0,0,0.75)', k: s * z });
    slide(ctx, env, st);
    ctx.restore();
    ctx.restore();
  });
})();
