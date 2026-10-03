/* Levels · the seven levels of motion as one journey (no words: the deck's headline sits right above it)
 * A rising path with seven stations (slides, website, reel, B-roll, logo, style wall, x100). Each station is its
 * level's real loop running live in a small card; a clay pulse travels the path and lights each station as it passes
 * (medal fills clay, card brightens), then the light moves on. One pass per loop; lights and pulse wrap seamlessly.
 * Needs level-1.js ... level-7.js loaded (it renders them via STORY_KIT.mini). */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10, N = 7, CW = 300, CH = CW * 9 / 16, MR = 24;
  // nodes along a rising curve; cards alternate above / below the path
  const NODES = Array.from({ length: N }, (_, k) => [236 + k * 241, 652 - 196 * Math.pow(k / (N - 1), 1.15)]);
  const cat = (pts, n = 16) => {
    const o = [], g = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let k = 0; k < n; k++) {
        const u = k / n, u2 = u * u, u3 = u2 * u;
        o.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)]);
      }
    }
    o.push(pts[pts.length - 1]);
    return o;
  };
  const LEAD = [[NODES[0][0] - 170, NODES[0][1] + 22]], TAIL = [[NODES[N - 1][0] + 190, NODES[N - 1][1] - 30]];
  const PATH = P.wob(cat([...LEAD, ...NODES, ...TAIL]), 0.8, 91, 90);
  // where each node sits along the path (fraction of its length)
  const FR = NODES.map(([nx, ny]) => { const L = P.lens(PATH), T = L[L.length - 1]; let best = 0, bd = 1e9; PATH.forEach(([x, y], i) => { const d = (x - nx) ** 2 + (y - ny) ** 2; if (d < bd) { bd = d; best = i; } }); return L[best] / T; });
  const cardAt = k => { const [x, y] = NODES[k], up = k % 2 === 0; return { x: x - CW / 2, y: up ? y - MR - 38 - CH : y + MR + 38, up }; };

  // the pulse makes one pass per loop: u runs a little past both ends so it enters and leaves unseen
  const pulseU = t => lerp(-0.04, 1.04, t / DUR);
  // a station lights as the pulse arrives, holds, then fades; periodic so the last stations fade across the wrap
  const lit = (t, k) => {
    const arrive = (FR[k] + 0.04) / 1.08, d = K.wrap(t / DUR - arrive);
    return d < 0.035 ? E.out(d / 0.035) : d < 0.3 ? 1 : d < 0.4 ? 1 - E.inOut((d - 0.3) / 0.1) : 0;
  };

  function medal(ctx, k, a) {
    const [x, y] = NODES[k];
    if (a > 0) K.glow(ctx, x, y, 70, C.clay, 0.45 * a);
    ctx.beginPath(); ctx.arc(x, y, MR, 0, TAU); ctx.fillStyle = K.mix('#0B0C10', C.clay, a); ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = C.clay; ctx.stroke();
    if (a > 0) { ctx.beginPath(); ctx.arc(x, y, MR + 8, 0, TAU); ctx.strokeStyle = `rgba(217,119,87,${0.25 * a})`; ctx.lineWidth = 6; ctx.stroke(); }
    K.serif(ctx, String(k + 1), x, y + 9, 26, { color: K.mix('#F4F1EA', '#FFFFFF', a), align: 'center' });
  }

  const ART = [
    { key: 'lv-ochre2', tone: 'ochre', seed: 93, pts: [[-40, -40], [330, -40], [304, 100], [218, 176], [-40, 214]], torn: [false, true, true, true, false], sketch: 'compass', sx: 116, sy: 62, dim: 0.14 },
    { key: 'lv-zebra2', tone: 'zebra', seed: 94, pts: [[1790, 850], [1960, 826], [1960, 1120], [1840, 1120]], torn: [true, false, false, true], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop('levels', DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.2) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    // the path: a quiet rule, a clay trail behind the pulse, a glowing head
    K.ink(ctx, PATH, { w: 1.6, alpha: 0.3 });
    const u = pulseU(t), head = Math.min(1, Math.max(0, u)), headA = K.smooth(seg(u, -0.02, 0.02)) * (1 - K.smooth(seg(u, 0.98, 1.02)));
    for (let k = 0; k < 8; k++) {
      const a0 = u - 0.18 * (k + 1) / 8, a1 = u - 0.18 * k / 8;
      K.ink(ctx, PATH, { from: Math.max(0, a0), to: Math.min(1, a1), w: 2.6, color: C.clay, alpha: headA * (1 - k / 8) * 0.9 });
    }
    // stations: stem, live card, medal
    for (let k = 0; k < N; k++) {
      const a = lit(t, k), c = cardAt(k), [nx, ny] = NODES[k], sc = 1 + 0.035 * a;
      ctx.strokeStyle = `rgba(244,241,234,${0.22 + 0.4 * a})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(nx, c.up ? ny - MR : ny + MR); ctx.lineTo(nx, c.up ? c.y + CH : c.y); ctx.stroke();
      ctx.save(); ctx.translate(nx, c.up ? c.y + CH : c.y); ctx.scale(sc, sc); ctx.translate(-nx, -(c.up ? c.y + CH : c.y));
      K.shadow(ctx, env, () => { K.rr(ctx, c.x, c.y, CW, CH, 12); ctx.fillStyle = '#000'; ctx.fill(); }, { blur: 40, y: 18, color: `rgba(0,0,0,${0.5 + 0.3 * a})` });
      ctx.save(); K.rr(ctx, c.x, c.y, CW, CH, 12); ctx.clip();
      const key = String(k + 1), L = STORY_LOOPS[key];
      if (L) K.mini(ctx, key, t * L.dur / DUR, c.x, c.y, CW, CH);
      ctx.fillStyle = `rgba(7,8,12,${0.66 * (1 - a)})`; ctx.fillRect(c.x, c.y, CW, CH);
      ctx.restore();
      K.rr(ctx, c.x, c.y, CW, CH, 12); ctx.lineWidth = 1.2 + 1.2 * a; ctx.strokeStyle = K.mix('#F4F1EA', C.clay, a, 0.35 + 0.6 * a); ctx.stroke();
      ctx.restore();
      medal(ctx, k, a);
    }
    if (headA > 0) { const [x, y] = P.at(PATH, head); K.nib(ctx, x, y, headA, 7); }
  });
})();
