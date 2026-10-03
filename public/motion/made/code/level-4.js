/* Level 4 · B-roll · "Any size"
 * set-up : one 16:9 frame: a coffee cup on a table, its steam rising toward the words
 * turn   : the frame morphs 16:9 -> 9:16 -> 1:1 while the scene re-lays itself inside (never a crop)
 * pay-off: back to 16:9; the steam never stops, it is the thread through every size */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 9;
  const CX = 960, CY = 526;
  // layouts: frame size, cup (saucer centre, scale), words (baseline positions, size, align), table, steam lean
  const L169 = { w: 1104, h: 621, cup: [-246, 176, 1.12], any: [34, 34, 116, 'l'], size: [null, 34, 116, 'l'], table: 190, lean: 150, label: '16:9' };
  const L916 = { w: 396, h: 704, cup: [0, 256, 0.88], any: [null, -196, 84, 'c'], size: [null, -196, 84, 'c'], table: 274, lean: 6, label: '9:16' };
  const L11 = { w: 640, h: 640, cup: [0, 244, 0.96], any: [null, -196, 96, 'c'], size: [null, -196, 96, 'c'], table: 264, lean: -20, label: '1:1' };
  const KEYS = [[0, L169], [1.8, L169], [2.75, L916], [4.6, L916], [5.55, L11], [7.4, L11], [8.35, L169], [9, L169]];

  function state(t) {
    let i = 0; while (i < KEYS.length - 2 && t >= KEYS[i + 1][0]) i++;
    const [ta, A] = KEYS[i], [tb, B] = KEYS[i + 1], u = A === B ? 0 : E.inOut(seg(t, ta, tb));
    // every layout sets the words on one line, so they travel as one unit and keep their spacing
    const wu = [[u, u], [u, u]];
    return { A, B, u, wu };
  }
  // word positions for one layout (left x, baseline y, size), computed with real metrics
  function words(ctx, Lo) {
    const wa = K.serifW(ctx, 'Any', Lo.any[2]), ws = K.serifW(ctx, 'size', Lo.size[2]), sp = Lo.any[2] * 0.26;
    if (Lo === L169) return [[Lo.any[0], Lo.any[1], Lo.any[2]], [Lo.any[0] + wa + sp, Lo.size[1], Lo.size[2]]];
    const tot = wa + sp + ws; return [[-tot / 2, Lo.any[1], Lo.any[2]], [-tot / 2 + wa + sp, Lo.size[1], Lo.size[2]]];
  }

  // ---- the cup (saucer centre at 0,0)
  function cup(ctx, env, t, s) {
    ctx.save(); ctx.scale(s, s);
    const INK = 'rgba(20,18,15,0.9)';
    // table shadow
    ctx.save(); ctx.scale(1, 0.2); const sg = ctx.createRadialGradient(0, 40, 0, 0, 40, 210); sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sg; ctx.fillRect(-220, -180, 440, 440); ctx.restore();
    // saucer
    ctx.beginPath(); ctx.ellipse(0, 0, 156, 28, 0, 0, TAU); ctx.fillStyle = K.paper(ctx, '#ECE6DA', 7); ctx.fill();
    const sh = ctx.createLinearGradient(-156, 0, 156, 0); sh.addColorStop(0, 'rgba(40,28,18,0.22)'); sh.addColorStop(0.5, 'rgba(40,28,18,0)'); sh.addColorStop(1, 'rgba(40,28,18,0.3)');
    ctx.fillStyle = sh; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -3, 100, 15, 0, 0, TAU); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(20,18,15,0.45)'; ctx.stroke();
    // handle (behind-right)
    ctx.beginPath(); ctx.moveTo(84, -124); ctx.bezierCurveTo(152, -128, 150, -52, 76, -48); ctx.lineWidth = 15; ctx.strokeStyle = '#E9E2D4'; ctx.stroke();
    ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(86, -132); ctx.bezierCurveTo(162, -138, 160, -44, 74, -40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(84, -116); ctx.bezierCurveTo(140, -118, 138, -60, 78, -56); ctx.stroke();
    // body
    const body = () => { ctx.beginPath(); ctx.moveTo(-94, -150); ctx.bezierCurveTo(-92, -70, -80, -22, -56, -10); ctx.lineTo(56, -10); ctx.bezierCurveTo(80, -22, 92, -70, 94, -150); ctx.closePath(); };
    body();
    ctx.fillStyle = K.paper(ctx, '#F2ECE1', 8); ctx.fill();
    const bg = ctx.createLinearGradient(-94, 0, 94, 0); bg.addColorStop(0, 'rgba(40,28,18,0.30)'); bg.addColorStop(0.35, 'rgba(40,28,18,0)'); bg.addColorStop(0.7, 'rgba(255,240,220,0.06)'); bg.addColorStop(1, 'rgba(40,28,18,0.34)');
    ctx.fillStyle = bg; ctx.fill();
    // ink hatching on the shadow side, a highlight on the lit side
    ctx.save(); body(); ctx.clip();
    ctx.strokeStyle = 'rgba(20,18,15,0.34)'; ctx.lineWidth = 1.4;
    for (let k = 0; k < 10; k++) { const y = -140 + k * 13; ctx.beginPath(); ctx.moveTo(-96, y + 10); ctx.lineTo(-70, y - 4); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,250,240,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(58, -136); ctx.bezierCurveTo(62, -96, 58, -60, 44, -30); ctx.stroke();
    ctx.restore();
    // clay band
    ctx.save(); body(); ctx.clip(); ctx.fillStyle = C.clay; ctx.beginPath(); ctx.ellipse(0, -104, 110, 19, 0, 0, Math.PI); ctx.ellipse(0, -92, 110, 19, 0, Math.PI, 0, true); ctx.fill(); ctx.restore();
    body(); ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke();
    // rim + coffee
    ctx.beginPath(); ctx.ellipse(0, -150, 94, 19, 0, 0, TAU); ctx.fillStyle = '#EFE8DC'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -149, 84, 15, 0, 0, TAU); const cg = ctx.createRadialGradient(-10, -152, 2, 0, -149, 84); cg.addColorStop(0, '#6B4226'); cg.addColorStop(0.55, '#3A2415'); cg.addColorStop(1, '#22140B'); ctx.fillStyle = cg; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(20,18,15,0.6)'; ctx.stroke();
    // latte-art heart that slowly turns
    ctx.save(); ctx.translate(0, -149); ctx.scale(1, 0.19); ctx.rotate(0.35 * Math.sin(TAU * t / DUR));
    ctx.fillStyle = 'rgba(236,214,186,0.85)'; ctx.beginPath(); ctx.moveTo(0, 40); ctx.bezierCurveTo(-58, 4, -40, -44, 0, -18); ctx.bezierCurveTo(40, -44, 58, 4, 0, 40); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  // ---- steam: three wisps, periodic in the loop, leaning toward the words; one ribbon each, faded by a vertical gradient
  function steam(ctx, t, x0, y0, s, lean, H) {
    for (let j = 0; j < 3; j++) {
      const bx = x0 + [-30, 4, 34][j] * s, ph = [0.2, 2.1, 4.0][j], hh = H * [0.9, 1, 0.8][j];
      const pts = [];
      for (let v = 0; v <= 1.0001; v += 1 / 70) {
        const w1 = Math.sin(TAU * (v * 1.25 - 2 * t / DUR) + ph), w2 = Math.sin(TAU * (v * 2.2 - 3 * t / DUR) + ph * 1.7);
        pts.push([bx + (6 + 40 * v) * s * (0.75 * w1 + 0.25 * w2) + lean * v * v, y0 - v * hh]);
      }
      const grad = (a0, a1, a2) => { const g = ctx.createLinearGradient(0, y0, 0, y0 - hh); g.addColorStop(0, 'rgba(246,240,230,0)'); g.addColorStop(0.1, `rgba(246,240,230,${a0})`); g.addColorStop(0.45, `rgba(246,240,230,${a1})`); g.addColorStop(1, `rgba(246,240,230,${a2})`); return g; };
      K.ribbon(ctx, pts, { wf: (dx, dy, f) => (26 * (1 - f) + 10) * s, color: grad(0.10, 0.06, 0) });
      K.ribbon(ctx, pts, { wf: (dx, dy, f) => (9 * (1 - f) + 3) * s, color: grad(0.34, 0.16, 0) });
    }
  }

  const ART = [
    { key: 'l4-ochre', tone: 'ochre', seed: 41, pts: [[1600, -40], [1960, -40], [1960, 250], [1800, 214], [1660, 120]], torn: [false, false, true, true, true], sketch: 'compass', sx: 1830, sy: 60, dim: 0.14, lit: 1 },
    { key: 'l4-zebra', tone: 'zebra', seed: 42, pts: [[-40, 820], [150, 846], [170, 1120], [-40, 1120]], torn: [true, true, false, false], sketch: 'none', dim: 0.3, stripe: 0.4 },
  ];

  K.loop(4, DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.3) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    const { A, B, u, wu } = state(t);
    const fw = lerp(A.w, B.w, u), fh = lerp(A.h, B.h, u), fx = CX - fw / 2, fy = CY - fh / 2;
    // ghost guides for the three sizes
    ctx.save(); ctx.setLineDash([4, 8]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(244,241,234,0.11)';
    for (const G of [L169, L916, L11]) { K.rr(ctx, CX - G.w / 2, CY - G.h / 2, G.w, G.h, 16); ctx.stroke(); }
    ctx.restore();
    // frame body + scene
    K.shadow(ctx, env, () => { K.rr(ctx, fx, fy, fw, fh, 16); ctx.fillStyle = '#0E0B09'; ctx.fill(); }, { blur: 70, y: 30, color: 'rgba(0,0,0,0.7)' });
    ctx.save(); K.rr(ctx, fx, fy, fw, fh, 16); ctx.clip();
    const cupX = CX + lerp(A.cup[0], B.cup[0], u), cupY = CY + lerp(A.cup[1], B.cup[1], u), cs = lerp(A.cup[2], B.cup[2], u);
    const tableY = CY + lerp(A.table, B.table, u);
    let g = ctx.createRadialGradient(cupX, cupY - 140 * cs, 0, cupX, cupY - 140 * cs, 620);
    g.addColorStop(0, '#2A1D13'); g.addColorStop(0.5, '#150F0B'); g.addColorStop(1, '#0A0807'); ctx.fillStyle = g; ctx.fillRect(fx, fy, fw, fh);
    // table
    g = ctx.createLinearGradient(0, tableY, 0, fy + fh); g.addColorStop(0, '#1E1610'); g.addColorStop(1, '#0D0A08');
    ctx.fillStyle = g; ctx.fillRect(fx, tableY, fw, fy + fh - tableY);
    ctx.fillStyle = 'rgba(244,236,222,0.16)'; ctx.fillRect(fx, tableY, fw, 1.5);
    // soft window light falling across the back wall and the table
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cupX + 120 * cs, cupY - 260 * cs); ctx.rotate(-0.5);
    g = ctx.createLinearGradient(-260, 0, 260, 0); g.addColorStop(0, 'rgba(240,170,110,0)'); g.addColorStop(0.5, 'rgba(240,170,110,0.07)'); g.addColorStop(1, 'rgba(240,170,110,0)');
    ctx.fillStyle = g; ctx.fillRect(-260, -700, 520, 1400);
    ctx.restore();
    K.glow(ctx, cupX + 60, tableY + 6, 280, '#F0A06E', 0.12, { sy: 0.18 });
    // words re-lay per size
    const wa = words(ctx, A), wb = words(ctx, B);
    ['Any', 'size'].forEach((w, i) => {
      const [qx, qy] = wu[i], x = CX + lerp(wa[i][0], wb[i][0], qx), y = CY + lerp(wa[i][1], wb[i][1], qy), sz = lerp(wa[i][2], wb[i][2], qx);
      K.serif(ctx, w, x, y, sz, { color: C.moon });
    });
    // cup + steam
    ctx.save(); ctx.translate(cupX, cupY); cup(ctx, env, t, cs); ctx.restore();
    const lean = lerp(A.lean, B.lean, u);
    steam(ctx, t, cupX, cupY - 156 * cs, cs, lean, 330 * cs);
    // vignette inside the frame
    g = ctx.createRadialGradient(CX, CY, Math.min(fw, fh) * 0.3, CX, CY, Math.max(fw, fh) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = g; ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();
    // frame line
    ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(244,241,234,0.9)'; K.rr(ctx, fx, fy, fw, fh, 16); ctx.stroke();
    // dimension lines + ratio label
    ctx.save(); ctx.strokeStyle = 'rgba(244,241,234,0.34)'; ctx.lineWidth = 1.3;
    const dy = fy + fh + 38, dx = fx + fw + 38;
    ctx.beginPath(); ctx.moveTo(fx, dy); ctx.lineTo(fx + fw, dy); ctx.moveTo(fx, dy - 8); ctx.lineTo(fx, dy + 8); ctx.moveTo(fx + fw, dy - 8); ctx.lineTo(fx + fw, dy + 8);
    ctx.moveTo(dx, fy); ctx.lineTo(dx, fy + fh); ctx.moveTo(dx - 8, fy); ctx.lineTo(dx + 8, fy); ctx.moveTo(dx - 8, fy + fh); ctx.lineTo(dx + 8, fy + fh); ctx.stroke();
    const lw = 92; ctx.fillStyle = C.night; ctx.fillRect(CX - lw / 2, dy - 12, lw, 24);
    const la = 1 - Math.sin(Math.PI * u), lab = u < 0.5 ? A.label : B.label;
    K.sans(ctx, lab, CX, dy + 7, 19, { weight: 600, track: 0.12, align: 'center', color: C.moon, alpha: 0.75 * la });
    ctx.restore();
  });
})();
