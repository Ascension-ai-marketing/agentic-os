/* Level 3 · The reel · "Use them together"
 * set-up : a phone between two sources: a graphic sketch on torn ochre paper, a talking-head sketch on ivory
 * turn   : the top half pops the graphic (two marks pull together and lock); the bottom half is the face, talking
 * pay-off: the caption words light up one at a time as they are spoken; then it all relaxes back */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 9;
  const PH = { x: 960 - 238, y: 118, w: 476, h: 846, r: 66 };
  const SC = { x: PH.x + 13, y: PH.y + 13, w: PH.w - 26, h: PH.h - 26, r: 54 };
  const SPLIT = SC.y + SC.h / 2;
  const TOPC = { x: 960, y: (SC.y + SPLIT) / 2 + 14 };
  const FACE = { x: 960, y: SPLIT + 236, s: 1 };
  const WORDS = [['Use', 3.45], ['them', 3.95], ['together', 4.45]];
  const SYL = [[3.45, 3.78, 0.9], [3.95, 4.3, 0.75], [4.45, 4.66, 0.7], [4.68, 4.9, 0.95], [4.92, 5.3, 0.8]];

  // ---- speech + face motion
  const mouth = t => {
    let m = 0; for (const [a, b, k] of SYL) { if (t > a && t < b) m = Math.max(m, k * Math.sin(Math.PI * (t - a) / (b - a)) ** 0.8); }
    return m;
  };
  const talking = t => K.env(t, 3.2, 3.5, 5.3, 5.8);
  const blink = t => { for (const b of [1.3, 3.1, 6.35, 8.2]) { const d = Math.abs(t - b); if (d < 0.09) return 1 - d / 0.09; } return 0; };

  // ---- the face, drawn around (0,0) = head centre; paper cut-out with ink lines
  const cat = (pts, closed = true, n = 10) => {                     // Catmull-Rom through the points
    const o = [], N = pts.length, g = i => pts[closed ? (i + N) % N : Math.max(0, Math.min(N - 1, i))];
    for (let i = 0; i < (closed ? N : N - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let k = 0; k < n; k++) {
        const u = k / n, u2 = u * u, u3 = u2 * u;
        o.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)]);
      }
    }
    if (!closed) o.push(pts[N - 1]);
    return o;
  };
  const HEAD = cat([[0, -114], [48, -104], [78, -64], [82, -8], [74, 44], [52, 84], [20, 104], [0, 107], [-20, 104], [-52, 84], [-74, 44], [-82, -8], [-78, -64], [-48, -104]]);
  const HAIR = cat([[-84, -22], [-94, -74], [-68, -124], [-18, -146], [40, -142], [84, -112], [96, -60], [88, -18], [80, -46], [62, -72], [30, -80], [4, -70], [-22, -84], [-50, -80], [-72, -58], [-80, -30]]);
  const SHIRT = [[-36, 90], [-40, 150], [-120, 176], [-206, 214], [-238, 330], [238, 330], [206, 214], [120, 176], [40, 150], [36, 90]];
  function smoothPoly(ctx, pts, close = true) {
    ctx.beginPath();
    const n = pts.length, get = i => pts[(i + n) % n];
    ctx.moveTo((get(0)[0] + get(1)[0]) / 2, (get(0)[1] + get(1)[1]) / 2);
    for (let i = 1; i <= (close ? n : n - 2); i++) { const a = get(i), b = get(i + 1); ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    if (close) ctx.closePath();
  }
  const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  function face(ctx, env, t, o = {}) {
    const m = o.still ? 0 : mouth(t), bl = o.still ? 0 : blink(t), tk = o.still ? 0 : talking(t);
    const INK = '#191713';
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // shoulders + shirt (ivory paper) with a little hatching
    smoothPoly(ctx, SHIRT, false); ctx.lineTo(238, 330); ctx.lineTo(-238, 330); ctx.closePath();
    ctx.fillStyle = K.paper(ctx, '#EFE9DD', 4); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
    ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(25,23,19,0.45)';
    for (let k = 0; k < 9; k++) { const x = -196 + k * 9; ctx.beginPath(); ctx.moveTo(x, 236 + k * 2); ctx.lineTo(x + 26, 206 + k * 2.5); ctx.stroke(); }
    for (let k = 0; k < 9; k++) { const x = 130 + k * 9; ctx.beginPath(); ctx.moveTo(x, 206 + k * 3); ctx.lineTo(x + 24, 236 + k * 3); ctx.stroke(); }
    // collar
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-40, 150); ctx.quadraticCurveTo(0, 196, 40, 150); ctx.stroke();
    // head group (nods while talking)
    const nod = tk * (0.022 * Math.sin(t * 5.3) + 0.012 * Math.sin(t * 8.7)), tilt = 0.012 * Math.sin(TAU * t / DUR);
    ctx.save(); ctx.translate(0, 70); ctx.rotate(nod + tilt); ctx.translate(0, -70 - tk * 2 * Math.sin(t * 6.1));
    // neck
    ctx.beginPath(); ctx.moveTo(-34, 70); ctx.lineTo(-38, 156); ctx.lineTo(38, 156); ctx.lineTo(34, 70); ctx.closePath();
    ctx.fillStyle = K.paper(ctx, '#F4EFE6', 5); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-34, 74); ctx.lineTo(-37, 150); ctx.moveTo(34, 74); ctx.lineTo(37, 150); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(25,23,19,0.4)';
    for (let k = 0; k < 8; k++) { const x = -30 + k * 8.5; ctx.beginPath(); ctx.moveTo(x, 104); ctx.lineTo(x + 10, 122 - Math.abs(k - 3.5) * 2); ctx.stroke(); }
    // ears
    ctx.fillStyle = '#F2ECE2'; ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 76, -18); ctx.bezierCurveTo(sx * 100, -26, sx * 102, 20, sx * 74, 26); ctx.fill(); ctx.stroke(); }
    // head
    poly(ctx, HEAD);
    ctx.fillStyle = K.paper(ctx, '#F6F1E8', 6); ctx.fill();
    ctx.save(); ctx.clip();
    const sh = ctx.createLinearGradient(-80, 0, 80, 0); sh.addColorStop(0, 'rgba(60,40,24,0.12)'); sh.addColorStop(0.42, 'rgba(60,40,24,0)'); sh.addColorStop(1, 'rgba(60,40,24,0.04)');
    ctx.fillStyle = sh; ctx.fillRect(-90, -120, 180, 240);
    // warmth on the cheeks
    for (const sx of [-1, 1]) { const cg = ctx.createRadialGradient(sx * 44, 22, 0, sx * 44, 22, 26); cg.addColorStop(0, 'rgba(226,140,110,0.20)'); cg.addColorStop(1, 'rgba(226,140,110,0)'); ctx.fillStyle = cg; ctx.fillRect(sx * 44 - 26, -4, 52, 52); }
    // ink hatching on the shadow side of the face and under the cheekbone
    ctx.strokeStyle = 'rgba(25,23,19,0.42)'; ctx.lineWidth = 1.25;
    for (let k = 0; k < 9; k++) { const y = -2 + k * 9; ctx.beginPath(); ctx.moveTo(-80 + k * 1.2, y); ctx.lineTo(-64 + k * 1.8, y - 12); ctx.stroke(); }
    for (let k = 0; k < 5; k++) { const x = -18 + k * 9; ctx.beginPath(); ctx.moveTo(x, 98 - Math.abs(k - 2) * 2); ctx.lineTo(x + 8, 88 - Math.abs(k - 2) * 2); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 3.2; poly(ctx, HEAD); ctx.stroke();
    // hair: ink mass with a few light strands, swept to one side
    poly(ctx, HAIR); ctx.fillStyle = INK; ctx.fill();
    ctx.save(); poly(ctx, HAIR); ctx.clip();
    ctx.strokeStyle = 'rgba(244,241,234,0.3)'; ctx.lineWidth = 1.3;
    for (let k = 0; k < 13; k++) { const x = -86 + k * 14; ctx.beginPath(); ctx.moveTo(x, -140 + Math.abs(k - 6) * 3); ctx.quadraticCurveTo(x + 22, -112, x + 40 + k * 1.5, -76); ctx.stroke(); }
    ctx.restore();
    // brows (lift a touch on stressed syllables)
    const lift = m * 3;
    ctx.strokeStyle = INK; ctx.lineWidth = 4.2;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 16, -36 - lift); ctx.quadraticCurveTo(sx * 33, -46 - lift, sx * 52, -38 - lift * 0.6); ctx.stroke(); }
    // eyes
    for (const sx of [-1, 1]) {
      const ex = sx * 33, ey = -12, open = 1 - bl;
      ctx.save(); ctx.translate(ex, ey);
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -11 * open - 1, 14, 0); ctx.quadraticCurveTo(0, 7 * open + 1, -14, 0); ctx.closePath();
      ctx.fillStyle = '#FBF8F2'; ctx.fill();
      if (open > 0.25) { ctx.save(); ctx.clip(); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(sx * 1.2, -1, 6.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * 1.2 + 2, -3.4, 1.7, 0, TAU); ctx.fill(); ctx.restore(); }
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-15, 0.5); ctx.quadraticCurveTo(0, -11 * open - 2, 15, 0.5); ctx.stroke();
      ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(25,23,19,0.55)'; ctx.beginPath(); ctx.moveTo(-11, 3); ctx.quadraticCurveTo(0, 7 * open + 3, 12, 2); ctx.stroke();
      ctx.restore();
    }
    // nose
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(3, -6); ctx.quadraticCurveTo(10, 16, 9, 26); ctx.quadraticCurveTo(4, 31, -5, 28); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-12, 26); ctx.quadraticCurveTo(-9, 29, -5, 28); ctx.stroke();
    // mouth: opening follows the syllables
    const my = 52, mw = 25 + 3 * m, open = 2 + 24 * m;
    ctx.beginPath(); ctx.moveTo(-mw, my); ctx.quadraticCurveTo(0, my - 5 + m * 2, mw, my); ctx.quadraticCurveTo(0, my + open, -mw, my); ctx.closePath();
    ctx.fillStyle = m > 0.05 ? '#2B1A14' : 'rgba(0,0,0,0)'; ctx.fill();
    if (m > 0.15) { ctx.save(); ctx.clip(); ctx.fillStyle = '#F4EFE6'; ctx.fillRect(-mw, my - 6, mw * 2, 5 + m * 2); ctx.fillStyle = '#B86A55'; ctx.beginPath(); ctx.ellipse(0, my + open * 0.8, mw * 0.55, open * 0.35, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(-mw - 2, my + 1); ctx.quadraticCurveTo(0, my - 5 + m * 2, mw + 2, my + 1); ctx.stroke();
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(25,23,19,0.6)'; ctx.beginPath(); ctx.moveTo(-mw * 0.55, my + open + 7); ctx.quadraticCurveTo(0, my + open + 11, mw * 0.55, my + open + 7); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ---- the two marks (abstract): an ivory ring and a clay spark
  function spark(ctx, x, y, r, rot, col) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 === 0 ? r : r * 0.3; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.restore();
  }
  function ring(ctx, x, y, r, w, a) {
    ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
  }
  function graphic(ctx, env, t) {
    const lock = E.inOut(seg(t, 1.1, 2.0)) * (1 - E.inOut(seg(t, 7.45, 8.75)));
    const drift = Math.sin(TAU * t / DUR) * 6;
    const sep = 128 * (1 - lock), rest = 1 - lock;
    const pop = 1 + 0.08 * Math.sin(Math.PI * seg(t, 1.98, 2.4)) + 0.018 * Math.sin(TAU * t / DUR * 3) * K.env(t, 2.4, 3, 7, 7.45);
    ctx.save(); ctx.translate(TOPC.x, TOPC.y); ctx.scale(pop, pop);
    // faint construction under the marks
    ctx.strokeStyle = 'rgba(244,241,234,0.09)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-210, 0); ctx.lineTo(210, 0); ctx.stroke(); ctx.setLineDash([]);
    const k = 1 - 0.2 * rest, a = 1 - 0.35 * rest;
    ring(ctx, -sep + drift * rest, 0, 88 * k, 15 * k, a);
    K.glow(ctx, sep - drift * rest, 0, 100, C.clay, 0.3 * a);
    ctx.save(); ctx.globalAlpha *= a; spark(ctx, sep - drift * rest, 0, 60 * k, (Math.PI / 2) * 2 * t / DUR, C.clay); ctx.restore();
    // lock: ripple + ticks
    const rp = seg(t, 1.98, 2.85);
    if (rp > 0 && rp < 1) { ctx.save(); ctx.globalAlpha *= (1 - rp); ctx.beginPath(); ctx.arc(0, 0, 90 + 120 * E.out(rp), 0, TAU); ctx.strokeStyle = C.clay; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore(); }
    const tk = K.env(t, 1.98, 2.15, 2.35, 2.85);
    if (tk > 0) { ctx.save(); ctx.globalAlpha *= tk; ctx.strokeStyle = C.moon; ctx.lineWidth = 2.2; for (let q = 0; q < 8; q++) { const an = q * Math.PI / 4 + 0.39, r0 = 118 + 10 * tk, r1 = r0 + 18; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0); ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); ctx.stroke(); } ctx.restore(); }
    ctx.restore();
  }

  // ---- captions: all three words dim, each lights as spoken, the spoken word gets a clay underline
  function captions(ctx, t) {
    const size = 46, y = SPLIT + 70, gap = 16;
    const ws = WORDS.map(([w]) => K.serifW(ctx, w, size)), total = ws.reduce((a, b) => a + b, 0) + gap * 2;
    const plate = 1;
    const x0 = 960 - total / 2;
    ctx.save(); ctx.globalAlpha *= plate;
    K.rr(ctx, x0 - 26, y - 46, total + 52, 66, 16); ctx.fillStyle = 'rgba(10,10,12,0.8)'; ctx.fill();
    let x = x0;
    WORDS.forEach(([w, ts], i) => {
      const on = E.out(seg(t, ts - 0.05, ts + 0.18)) * (1 - E.inOut(seg(t, 7.4 + i * 0.08, 7.9 + i * 0.08)));
      K.serif(ctx, w, x, y, size, { color: C.moon, alpha: 0.32 + 0.68 * on });
      const next = i < 2 ? WORDS[i + 1][1] : 5.6;
      const ul = E.out(seg(t, ts, ts + 0.25)) * (1 - E.inOut(seg(t, next - 0.05, next + 0.15)));
      if (ul > 0) { ctx.fillStyle = C.clay; ctx.fillRect(x, y + 10, ws[i] * ul, 4); }
      x += ws[i] + gap;
    });
    ctx.restore();
  }

  // ---- side sources + leaders
  const LEFT = { key: 'l3-ochre', tone: 'ochre', seed: 31, pts: [[250, 210], [610, 196], [626, 486], [262, 506]], torn: [true, true, true, true], sketch: 'compass', sx: 330, sy: 280, dim: 0.14 };
  const RIGHT = { key: 'l3-ivory', tone: 'ivory', seed: 32, pts: [[1310, 560], [1664, 572], [1654, 870], [1300, 858]], torn: [true, true, true, true], sketch: 'none', dim: 0.08 };
  const LEAD_L = P.bez([618, 372], [660, 360], [690, 330], [PH.x - 14, 318], 40);
  const LEAD_R = P.bez([1300, 700], [1260, 712], [1236, 742], [PH.x + PH.w + 14, 760], 40);

  K.loop(3, DUR, (ctx, t, env) => {
    const p = env.p;
    // left source: torn ochre sheet with an ink sketch of the two marks
    ctx.save(); ctx.translate(Math.sin(TAU * p) * 4, Math.cos(TAU * p) * 3);
    K.torn(ctx, env, LEFT);
    ctx.save(); ctx.translate(446, 352); ctx.rotate(-0.04);
    ctx.strokeStyle = 'rgba(26,20,12,0.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-44, 0, 40, 0, TAU); ctx.stroke();
    spark(ctx, 50, 0, 30, 0.2, 'rgba(26,20,12,0.85)');
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(18, 0); ctx.stroke(); ctx.setLineDash([]);
    K.arrow(ctx, 20, 0, 0, { size: 7, w: 1.6, color: 'rgba(26,20,12,0.85)' }); K.arrow(ctx, -6, 0, Math.PI, { size: 7, w: 1.6, color: 'rgba(26,20,12,0.85)' });
    ctx.restore();
    ctx.restore();
    // right source: ivory sheet with the portrait sketch
    ctx.save(); ctx.translate(Math.sin(TAU * p + 2) * 4, Math.cos(TAU * p + 1.3) * 3);
    K.torn(ctx, env, RIGHT);
    ctx.save(); ctx.beginPath(); ctx.moveTo(1316, 574); ctx.lineTo(1650, 584); ctx.lineTo(1642, 852); ctx.lineTo(1306, 842); ctx.closePath(); ctx.clip();
    ctx.translate(1482, 700); ctx.rotate(0.03); ctx.scale(0.62, 0.62); face(ctx, env, t, { still: true });
    ctx.restore();
    ctx.restore();
    // leaders (dotted, flowing while live)
    const l1 = E.inOut(seg(t, 0.45, 1.25)), l1e = E.inOut(seg(t, 7.3, 8.1));
    const l2 = E.inOut(seg(t, 2.25, 3.05)), l2e = E.inOut(seg(t, 7.4, 8.2));
    K.dots(ctx, LEAD_L, { from: l1e, to: l1, gap: 12, r: 2, alpha: 0.55, off: t * 30 });
    K.dots(ctx, LEAD_R, { from: l2e, to: l2, gap: 12, r: 2, alpha: 0.55, off: t * 30 });
    if (l1 > l1e) { const q = P.at(LEAD_L, Math.min(l1, 1)); K.arrow(ctx, q[0], q[1], q[2], { size: 10, w: 2, alpha: 0.7 * (1 - l1e) }); }
    if (l2 > l2e) { const q = P.at(LEAD_R, Math.min(l2, 1)); K.arrow(ctx, q[0], q[1], q[2], { size: 10, w: 2, alpha: 0.7 * (1 - l2e) }); }

    // phone
    K.shadow(ctx, env, () => { K.rr(ctx, PH.x, PH.y, PH.w, PH.h, PH.r); ctx.fillStyle = '#0A0B0E'; ctx.fill(); }, { blur: 80, y: 36, color: 'rgba(0,0,0,0.75)' });
    ctx.save(); K.rr(ctx, SC.x, SC.y, SC.w, SC.h, SC.r); ctx.clip();
    // top half: graphic stage
    let g = ctx.createRadialGradient(TOPC.x, TOPC.y, 0, TOPC.x, TOPC.y, 330);
    g.addColorStop(0, '#191A20'); g.addColorStop(1, '#0C0D11'); ctx.fillStyle = g; ctx.fillRect(SC.x, SC.y, SC.w, SPLIT - SC.y);
    graphic(ctx, env, t);
    // bottom half: torn ochre backdrop + the face
    ctx.fillStyle = '#0C0D11'; ctx.fillRect(SC.x, SPLIT, SC.w, SC.y + SC.h - SPLIT);
    K.torn(ctx, env, { key: 'l3-back', tone: 'ochre', seed: 33, pts: [[SC.x - 30, SPLIT + 6], [SC.x + SC.w + 30, SPLIT - 4], [SC.x + SC.w + 30, SC.y + SC.h + 30], [SC.x - 30, SC.y + SC.h + 30]], torn: [true, false, false, false], sketch: 'compass', sx: SC.x + SC.w - 70, sy: SPLIT + 120, dim: 0.26, lit: 0 });
    ctx.save(); ctx.translate(FACE.x, FACE.y); face(ctx, env, t); ctx.restore();
    captions(ctx, t);
    // glass sheen
    g = ctx.createLinearGradient(SC.x, SC.y, SC.x + SC.w, SC.y + SC.h * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(SC.x, SC.y, SC.w, SC.h);
    ctx.restore();
    // island + bezel line + side keys
    K.rr(ctx, 960 - 58, SC.y + 16, 116, 32, 16); ctx.fillStyle = '#050506'; ctx.fill();
    K.ink(ctx, P.rrect(PH.x, PH.y, PH.w, PH.h, PH.r, 5), { w: 2.4, alpha: 0.85 });
    ctx.strokeStyle = 'rgba(244,241,234,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(PH.x + PH.w + 3, PH.y + 210); ctx.lineTo(PH.x + PH.w + 3, PH.y + 300); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PH.x - 3, PH.y + 180); ctx.lineTo(PH.x - 3, PH.y + 230); ctx.moveTo(PH.x - 3, PH.y + 250); ctx.lineTo(PH.x - 3, PH.y + 300); ctx.stroke();
  });
})();
