/* Finale · the payoff: Jack's system window, Motion Library open
 * A dark app with a left sidebar; the "Motion Library" tab is highlighted at the lower left. The page shows all seven
 * levels as live tiles (their real loops). A cursor visits them one by one, the prompt improver turns a rough idea into
 * a full prompt, a logo is pulled from a URL and drops into the brand slot, and Launch pulses. Then it all eases back.
 * Words on screen: "Motion Library", "Launch" (3). Never "OS". Needs level-1.js ... level-7.js loaded. */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10;
  const WIN = { x: 124, y: 96, w: 1672, h: 872, r: 22 }, TB = 44, SW = 292;
  const MX = WIN.x + SW, MY = WIN.y + TB;
  const PB = { x: MX + 40, y: MY + 30, w: WIN.x + WIN.w - MX - 80, h: 176 };
  const TW = (PB.w - 3 * 26) / 4, TH = TW * 9 / 16, TY = PB.y + PB.h + 30;
  const tileRect = k => ({ x: PB.x + (k % 4) * (TW + 26), y: TY + Math.floor(k / 4) * (TH + 26), w: TW, h: TH });
  const SLOT = tileRect(7);
  const URLF = { x: PB.x, y: TY + 2 * (TH + 26) + 14, w: 660, h: 64 };
  const BTN = { w: 226, h: 64 }; BTN.x = PB.x + PB.w - BTN.w; BTN.y = URLF.y;
  const IMP = { x: PB.x + PB.w - 76, y: PB.y + 18, w: 58, h: 40 };

  // ---- the cursor's day: tiles 1..7, the improver, the URL field, Launch, home
  const center = r => [r.x + r.w * 0.58, r.y + r.h * 0.6];
  const STOPS = [];                                                     // [time it arrives, x, y, time it leaves]
  for (let k = 0; k < 7; k++) { const [x, y] = center(tileRect(k)); STOPS.push([k * 0.44, x, y, k * 0.44 + 0.2]); }
  STOPS.push([3.55, IMP.x + IMP.w / 2 + 6, IMP.y + IMP.h / 2 + 8, 3.95]);
  STOPS.push([5.35, URLF.x + 250, URLF.y + URLF.h / 2 + 8, 5.9]);
  STOPS.push([7.3, BTN.x + BTN.w * 0.55, BTN.y + BTN.h / 2 + 10, 8.7]);
  STOPS.push([9.95, STOPS[0][1], STOPS[0][2], 10]);
  function cursorAt(t) {
    for (let i = 0; i < STOPS.length - 1; i++) {
      const [a, x0, y0, l] = STOPS[i], [b, x1, y1] = STOPS[i + 1];
      if (t < a) return [x0, y0];
      if (t <= l) return [x0, y0];
      if (t < b) { const u = E.inOut(seg(t, l, b)), mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 40; return P.at(P.bez([x0, y0], [x0, lerp(y0, my, 0.6)], [x1, lerp(y1, my, 0.6)], [x1, y1], 30), u); }
    }
    return [STOPS[0][1], STOPS[0][2]];
  }
  const hoverOf = (t, k) => { const a = k * 0.44, tt = t > DUR - 1 ? t - DUR : t; return K.env(tt, a - 0.12, a + 0.02, a + 0.3, a + 0.46); };   // tile 1's hover starts just before the wrap

  // ---- sidebar icons (simple line icons, lucide-like)
  function icon(ctx, kind, x, y, col, a = 1) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= a; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const r = (x0, y0, w, h, rr = 3) => { ctx.beginPath(); ctx.roundRect(x0, y0, w, h, rr); ctx.stroke(); };
    ctx.beginPath();
    switch (kind) {
      case 'landmark': ctx.moveTo(-9, -3); ctx.lineTo(0, -9); ctx.lineTo(9, -3); ctx.moveTo(-9, 9); ctx.lineTo(9, 9); for (const cx of [-6, 0, 6]) { ctx.moveTo(cx, -1); ctx.lineTo(cx, 6); } ctx.stroke(); break;
      case 'inbox': ctx.moveTo(-9, 1); ctx.lineTo(-5, 1); ctx.lineTo(-3, 4); ctx.lineTo(3, 4); ctx.lineTo(5, 1); ctx.lineTo(9, 1); ctx.stroke(); r(-9, -8, 18, 16, 3); break;
      case 'chat': ctx.moveTo(-9, -7); ctx.lineTo(9, -7); ctx.lineTo(9, 5); ctx.lineTo(-3, 5); ctx.lineTo(-8, 9); ctx.lineTo(-8, 5); ctx.lineTo(-9, 5); ctx.closePath(); ctx.stroke(); break;
      case 'calendar': r(-9, -7, 18, 16, 3); ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(9, -2); ctx.moveTo(-4, -10); ctx.lineTo(-4, -5); ctx.moveTo(4, -10); ctx.lineTo(4, -5); ctx.stroke(); break;
      case 'memory': ctx.arc(-3, -2, 6, Math.PI * 0.6, Math.PI * 2.1); ctx.moveTo(9, 0); ctx.arc(3, 0, 6, 0, Math.PI * 1.3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke(); break;
      case 'palette': ctx.arc(0, 0, 9, 0.5, TAU - 0.2); ctx.quadraticCurveTo(2, 3, 5, 5); ctx.stroke(); for (const [px, py] of [[-4, -3], [1, -5], [-5, 2]]) { ctx.beginPath(); ctx.arc(px, py, 1.4, 0, TAU); ctx.fill(); } break;
      case 'globe': ctx.arc(0, 0, 9, 0, TAU); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke(); ctx.beginPath(); ctx.ellipse(0, 0, 4, 9, 0, 0, TAU); ctx.stroke(); break;
      case 'avatar': { const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10); g.addColorStop(0, '#E8C9A8'); g.addColorStop(1, '#6A5A4A'); ctx.fillStyle = g; ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); break; }
      case 'clapper': r(-9, -3, 18, 12, 2); ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-7, -9); ctx.lineTo(9, -6); ctx.lineTo(8, -3); ctx.moveTo(-3, -8); ctx.lineTo(-4, -3); ctx.moveTo(3, -7); ctx.lineTo(2, -3); ctx.stroke(); break;
      case 'gear': for (let k = 0; k < 8; k++) { const an = k * TAU / 8; ctx.moveTo(Math.cos(an) * 6, Math.sin(an) * 6); ctx.lineTo(Math.cos(an) * 9.5, Math.sin(an) * 9.5); } ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.stroke(); break;
    }
    ctx.restore();
  }
  const NAV1 = [['landmark', 74], ['inbox', 52], ['chat', 44], ['calendar', 66], ['memory', 58]];
  const NAV2 = [['palette', 50], ['globe', 58], ['avatar', 54]];
  function sidebar(ctx, t) {
    const x = WIN.x, y0 = MY;
    ctx.fillStyle = '#0A0B0F'; ctx.fillRect(x + 1, y0, SW - 1, WIN.h - TB - 1);
    ctx.fillStyle = 'rgba(244,241,234,0.08)'; ctx.fillRect(x + SW - 1, y0, 1.2, WIN.h - TB);
    // brand: an orbit mark and a greeked wordmark
    const bx = x + 42, by = y0 + 44;
    ctx.strokeStyle = 'rgba(244,241,234,0.7)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(bx, by, 13, 0, TAU); ctx.stroke();
    const oa = TAU * t / DUR; ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(bx + Math.cos(oa) * 13, by + Math.sin(oa) * 13, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = C.moon; ctx.beginPath(); ctx.arc(bx, by, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.62)'; K.rr(ctx, bx + 26, by - 9, 104, 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.26)'; K.rr(ctx, bx + 26, by + 6, 70, 5, 2.5); ctx.fill();
    const item = (kind, w, y, on = 0) => {
      icon(ctx, kind, x + 44, y, on ? C.clay : C.moon, on ? 1 : 0.55);
      ctx.fillStyle = `rgba(244,241,234,${0.3 + 0.2 * on})`; K.rr(ctx, x + 68, y - 4, w, 8, 4); ctx.fill();
    };
    ctx.fillStyle = 'rgba(244,241,234,0.2)'; K.rr(ctx, x + 32, y0 + 104, 64, 5, 2.5); ctx.fill();
    NAV1.forEach(([k, w], i) => item(k, w, y0 + 140 + i * 48));
    ctx.fillStyle = 'rgba(244,241,234,0.2)'; K.rr(ctx, x + 32, y0 + 412, 44, 5, 2.5); ctx.fill();
    NAV2.forEach(([k, w], i) => item(k, w, y0 + 448 + i * 48));
    // Motion Library: the highlighted tab at the lower left
    const ty = y0 + 448 + 3 * 48;
    K.rr(ctx, x + 16, ty - 24, SW - 32, 48, 12); ctx.fillStyle = 'rgba(217,119,87,0.16)'; ctx.fill();
    ctx.strokeStyle = 'rgba(217,119,87,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = C.clay; K.rr(ctx, x + 16, ty - 13, 3.5, 26, 2); ctx.fill();
    icon(ctx, 'clapper', x + 44, ty + 1, C.clay);
    K.sans(ctx, 'Motion Library', x + 68, ty + 8, 21, { weight: 600, track: 0, color: C.moon });
    // bottom: settings + profile
    const sy = WIN.y + WIN.h - 118;
    icon(ctx, 'gear', x + 44, sy, C.moon, 0.55); ctx.fillStyle = 'rgba(244,241,234,0.3)'; K.rr(ctx, x + 68, sy - 4, 60, 8, 4); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.08)'; ctx.fillRect(x + 20, sy + 30, SW - 40, 1.2);
    const py = WIN.y + WIN.h - 50;
    const ag = ctx.createRadialGradient(x + 40, py - 5, 2, x + 44, py, 18); ag.addColorStop(0, '#E9C39E'); ag.addColorStop(1, '#7A5238');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x + 44, py, 17, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.6)'; K.rr(ctx, x + 72, py - 10, 86, 8, 4); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.24)'; K.rr(ctx, x + 72, py + 4, 110, 5, 2.5); ctx.fill();
  }

  // ---- prompt improver: a rough idea -> a full prompt
  const SCRIBBLE = (() => { const o = []; for (let i = 0; i <= 60; i++) { const u = i / 60; o.push([PB.x + 92 + u * 270, PB.y + 42 + Math.sin(u * 19) * 3.2 + Math.sin(u * 7) * 2]); } return o; })();
  const LINES = [0.78, 0.94, 0.66, 0.86];
  function prompt(ctx, t) {
    const { x, y, w, h } = PB;
    K.rr(ctx, x, y, w, h, 16); ctx.fillStyle = '#0A0B0F'; ctx.fill(); ctx.strokeStyle = 'rgba(244,241,234,0.14)'; ctx.lineWidth = 1.3; ctx.stroke();
    // sparkle mark
    const sp = (cx, cy, r, col) => { ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = col; ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? r * 0.3 : r; k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(rr, 0); } ctx.closePath(); ctx.fill(); ctx.restore(); };
    sp(x + 44, y + 40, 13, C.clay);
    // the improve button (cursor clicks it)
    const press = K.env(t, 3.85, 3.92, 3.97, 4.12), glowA = K.env(t, 3.9, 4.0, 4.8, 5.4);
    K.glow(ctx, IMP.x + IMP.w / 2, IMP.y + IMP.h / 2, 60, C.clay, 0.35 * glowA);
    ctx.save(); ctx.translate(IMP.x + IMP.w / 2, IMP.y + IMP.h / 2); ctx.scale(1 - 0.06 * press, 1 - 0.06 * press);
    K.rr(ctx, -IMP.w / 2, -IMP.h / 2, IMP.w, IMP.h, IMP.h / 2); ctx.fillStyle = K.mix('#1A1C22', C.clay, glowA * 0.8); ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,234,0.25)'; ctx.lineWidth = 1.2; ctx.stroke();
    sp(0, 0, 9, C.moon); ctx.restore();
    // rough idea (a scribble) until it is improved, then the full prompt writes itself; both ease back at the end
    const imp = E.inOut(seg(t, 3.95, 4.35)) * (1 - E.inOut(seg(t, 8.8, 9.35)));
    K.ink(ctx, SCRIBBLE, { w: 3, alpha: 0.8 * (1 - imp) });
    const back = E.inOut(seg(t, 8.8, 9.35));
    LINES.forEach((f, i) => {
      const a0 = 4.15 + i * 0.28, grow = E.out(seg(t, a0, a0 + 0.36)) * (1 - back);
      if (grow <= 0) return;
      const ly = y + 42 + i * 34, lw = (w - 200) * f * grow;
      ctx.fillStyle = i === 0 ? 'rgba(217,119,87,0.9)' : 'rgba(244,241,234,0.9)'; ctx.beginPath(); ctx.arc(x + 88, ly, 3.2, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(244,241,234,${i === 0 ? 0.62 : 0.4})`; K.rr(ctx, x + 102, ly - 4.5, lw, 9, 4.5); ctx.fill();
      if (grow < 1 && grow > 0.02) { ctx.fillStyle = C.clay; ctx.fillRect(x + 108 + lw, ly - 12, 3, 24); }
    });
  }

  // ---- URL field (Firecrawl pulls the brand) + the logo that drops into the brand slot
  function urlField(ctx, t) {
    const { x, y, w, h } = URLF, cy = y + h / 2, read = K.env(t, 5.8, 5.95, 6.1, 6.5);
    K.rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = '#0A0B0F'; ctx.fill(); ctx.strokeStyle = `rgba(244,241,234,${0.16 + 0.2 * read})`; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.strokeStyle = 'rgba(244,241,234,0.55)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x + 32, cy, 9, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 23, cy); ctx.lineTo(x + 41, cy); ctx.stroke(); ctx.beginPath(); ctx.ellipse(x + 32, cy, 4, 9, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(244,241,234,0.42)'; K.rr(ctx, x + 58, cy - 4.5, 200, 9, 4.5); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.22)'; K.rr(ctx, x + 268, cy - 4.5, 60, 9, 4.5); ctx.fill();
    const lh = 17; K.glow(ctx, x + w - 96, cy, 50, '#FA5D19', 0.1 + 0.25 * read); K.firecrawl(ctx, x + w - 22 - 172 * lh / 40, cy - lh / 2, lh);
  }
  function logoMark(ctx, x, y, s, a) {                                   // a small brand mark (dawn disc)
    if (a <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= a;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.fillStyle = '#F4EFE6'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(0, 12, 8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 12 + 92, 92, 0, TAU); ctx.fillStyle = '#16140F'; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  function slot(ctx, t) {
    const { x, y, w, h } = SLOT, cx = x + w / 2, cy = y + h / 2;
    const landed = seg(t, 6.95, 7.0) >= 1 ? 1 : 0, out = E.inOut(seg(t, 8.85, 9.4));
    ctx.save(); ctx.setLineDash([6, 7]); K.rr(ctx, x, y, w, h, 12); ctx.strokeStyle = `rgba(244,241,234,${0.22 + 0.3 * landed * (1 - out)})`; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
    if (!landed || out >= 1) { ctx.strokeStyle = 'rgba(244,241,234,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke(); }
    // rise out of the URL field, hang, drop in with a bounce; lift away at the end
    const from = [URLF.x + URLF.w - 60, URLF.y + URLF.h / 2];
    const rise = E.inOut(seg(t, 6.1, 6.55)), drop = seg(t, 6.6, 7.0);
    if (t < 6.1 || out >= 1) return;
    let px, py, s = 0.9;
    if (t < 6.6) { const q = P.at(P.bez(from, [from[0] + 60, from[1] - 160], [cx, cy - 240], [cx, cy - 170], 30), rise); px = q[0]; py = q[1]; s = lerp(0.25, 0.9, rise); }
    else { px = cx; const b = drop < 0.7 ? E.in(drop / 0.7) : 1 - 0.14 * Math.sin(Math.PI * (drop - 0.7) / 0.3); py = lerp(cy - 170, cy, b); }
    if (t >= 7.0) { py = cy; s = 0.9 + 0.04 * Math.sin(Math.PI * seg(t, 7.0, 7.25)); }
    if (drop >= 1 && t < 7.6) { const r = seg(t, 7.0, 7.6); ctx.save(); ctx.globalAlpha = 0.6 * (1 - r); ctx.beginPath(); ctx.arc(cx, cy, 40 + 70 * E.out(r), 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore(); }
    logoMark(ctx, px, py - 6 * out, s * (1 - 0.3 * out), 1 - out);
  }

  // ---- Launch
  function launch(ctx, t) {
    const press = K.env(t, 7.42, 7.5, 7.55, 7.72), bs = 1 - 0.06 * press;
    const cx = BTN.x + BTN.w / 2, cy = BTN.y + BTN.h / 2;
    for (let k = 0; k < 3; k++) {
      const u = seg(t, 7.5 + k * 0.22, 8.6 + k * 0.22); if (u <= 0 || u >= 1) continue;
      ctx.save(); ctx.globalAlpha = 0.8 * (1 - u); const e = 70 * E.out(u);
      K.rr(ctx, BTN.x - e, BTN.y - e, BTN.w + 2 * e, BTN.h + 2 * e, BTN.h / 2 + e); ctx.strokeStyle = C.clay; ctx.lineWidth = 2.4; ctx.stroke(); ctx.restore();
    }
    K.glow(ctx, cx, cy, 190, C.clay, 0.5 * K.env(t, 7.48, 7.6, 7.9, 8.8));
    ctx.save(); ctx.translate(cx, cy); ctx.scale(bs, bs);
    K.rr(ctx, -BTN.w / 2, -BTN.h / 2, BTN.w, BTN.h, BTN.h / 2); ctx.fillStyle = C.clay; ctx.fill();
    K.sans(ctx, 'Launch', -18, 9, 26, { weight: 600, track: 0.01, align: 'center', color: C.ivory });
    ctx.strokeStyle = C.ivory; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(56, 8); ctx.lineTo(70, -6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(60, -6); ctx.lineTo(70, -6); ctx.lineTo(70, 4); ctx.stroke();
    ctx.restore();
  }

  const ARROW = [[0, 0], [0, 17.5], [4.6, 13.4], [7.6, 20.4], [10.4, 19.2], [7.4, 12.4], [13.2, 12.4]];
  function cursor(ctx, env, x, y, press) {
    const s = 2.2 * (1 - 0.1 * press);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    K.shadow(ctx, env, () => { ctx.beginPath(); ARROW.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fillStyle = C.ivory; ctx.fill(); }, { blur: 10, y: 4, color: 'rgba(0,0,0,0.6)', k: s });
    ctx.lineWidth = 1.3; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }

  const ART = [
    { key: 'fn-ochre', tone: 'ochre', seed: 101, pts: [[-40, -40], [250, -40], [226, 70], [150, 124], [-40, 156]], torn: [false, true, true, true, false], sketch: 'compass', sx: 80, sy: 44, dim: 0.14 },
    { key: 'fn-zebra', tone: 'zebra', seed: 102, pts: [[1826, 880], [1960, 860], [1960, 1120], [1850, 1120]], torn: [true, false, false, true], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop('finale', DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.2) * 3, Math.cos(TAU * p + i) * 2); K.torn(ctx, env, a); ctx.restore(); });
    // window
    K.shadow(ctx, env, () => { K.rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); ctx.fillStyle = '#0D0E13'; ctx.fill(); }, { blur: 90, y: 40, color: 'rgba(0,0,0,0.8)' });
    ctx.save(); K.rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); ctx.clip();
    ctx.fillStyle = '#0D0E13'; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    const lg = ctx.createRadialGradient(MX + 700, MY + 300, 0, MX + 700, MY + 300, 900); lg.addColorStop(0, 'rgba(250,249,245,0.035)'); lg.addColorStop(1, 'rgba(250,249,245,0)'); ctx.fillStyle = lg; ctx.fillRect(MX, MY, WIN.w - SW, WIN.h - TB);
    // title bar
    ctx.fillStyle = '#0A0B0F'; ctx.fillRect(WIN.x, WIN.y, WIN.w, TB); ctx.fillStyle = 'rgba(244,241,234,0.08)'; ctx.fillRect(WIN.x, WIN.y + TB - 1, WIN.w, 1.2);
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(WIN.x + 26 + k * 22, WIN.y + TB / 2, 6, 0, TAU); ctx.strokeStyle = 'rgba(244,241,234,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = 'rgba(244,241,234,0.14)'; K.rr(ctx, WIN.x + WIN.w / 2 - 110, WIN.y + TB / 2 - 5, 220, 10, 5); ctx.fill();
    sidebar(ctx, t);
    prompt(ctx, t);
    // seven live tiles: each is its level's real loop; the cursor lifts each one as it passes
    const launchSweep = seg(t, 7.5, 8.5);
    for (let k = 0; k < 7; k++) {
      const r = tileRect(k), hv = hoverOf(t, k), sc = 1 + 0.045 * hv, key = String(k + 1), L = STORY_LOOPS[key];
      ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(sc, sc); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
      if (hv > 0) K.shadow(ctx, env, () => { K.rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.fillStyle = '#000'; ctx.fill(); }, { blur: 40, y: 16, color: `rgba(0,0,0,${0.7 * hv})` });
      ctx.save(); K.rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.clip();
      if (L) K.mini(ctx, key, t * L.dur / DUR, r.x, r.y, r.w, r.h);
      if (launchSweep > 0 && launchSweep < 1) {
        ctx.globalCompositeOperation = 'lighter'; const sx = lerp(PB.x - 300, PB.x + PB.w + 300, E.inOut(launchSweep));
        const g = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0); g.addColorStop(0, 'rgba(255,220,190,0)'); g.addColorStop(0.5, 'rgba(255,220,190,0.22)'); g.addColorStop(1, 'rgba(255,220,190,0)');
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
      K.rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.lineWidth = 1.2 + 1.4 * hv; ctx.strokeStyle = K.mix('#F4F1EA', C.clay, hv, 0.18 + 0.72 * hv); ctx.stroke();
      ctx.restore();
    }
    slot(ctx, t);
    urlField(ctx, t);
    launch(ctx, t);
    ctx.restore();
    K.rr(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); ctx.strokeStyle = 'rgba(244,241,234,0.2)'; ctx.lineWidth = 1.4; ctx.stroke();
    // cursor + click ripples
    const [cx, cy] = cursorAt(t);
    for (const tc of [3.9, 5.8, 7.5]) { const u = seg(t, tc, tc + 0.5); if (u > 0 && u < 1) { ctx.save(); ctx.globalAlpha = 0.7 * (1 - u); ctx.beginPath(); ctx.arc(cx, cy, 8 + 34 * E.out(u), 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); } }
    cursor(ctx, env, cx, cy, Math.max(K.env(t, 3.84, 3.9, 3.95, 4.1), K.env(t, 5.74, 5.8, 5.85, 6.0), K.env(t, 7.44, 7.5, 7.55, 7.7)));
  }, { ground: { ly: 520 } });
})();
