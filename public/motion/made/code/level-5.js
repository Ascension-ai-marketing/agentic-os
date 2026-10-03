/* Level 5 · Logo + jingle · "Logo + jingle"
 * set-up : a site's address bar above a faint mark outline; Firecrawl reads the URL and grabs its logo
 * turn   : the logo flies out of the address bar, grows, and strikes in (a dawn horizon inside a disc)
 * pay-off: sound rings pulse out on the jingle's beat (da, da, da-da, DAA); it settles, glows, and dims back */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 9;
  const M = { x: 960, y: 452, R: 170 };
  const URL = { w: 620, h: 56 }; URL.x = 960 - URL.w / 2; URL.y = 118;
  const FAV = [URL.x + 36, URL.y + URL.h / 2], FAVR = 14;                   // the site's favicon = its logo, tiny
  const GRAB = 0.98, STRIKE = 1.6;                                           // logo lifts out of the bar, then lands
  const BEATS = [[2.32, 0.8, 0], [2.82, 0.8, 0], [3.32, 0.75, 0], [3.57, 0.75, 0], [3.82, 1.25, 1]];   // time, strength, accent

  const lit = t => (t < GRAB ? 0 : E.out(seg(t, GRAB, GRAB + 0.12))) * (1 - E.inOut(seg(t, 7.1, 8.4)));
  const outlineA = t => (t < STRIKE ? 1 : E.inOut(seg(t, 7.1, 8.4)));
  function pulse(t) { let s = 0; for (const [b, k] of BEATS) if (t > b) s += 0.04 * k * Math.exp(-(t - b) / 0.13); return s; }

  // the mark: an ivory disc holding a dawn planet, a clay sun on the rim
  function mark(ctx, env, t, L, part, R = M.R) {
    const apex = R * 0.3, Rp = R * 2.3, sunUp = lerp(2, 18, E.sine(seg(t, 1.8, 6.9))) * (1 - E.inOut(seg(t, 7.0, 8.3))) * R / M.R;
    ctx.save();
    if (part === 'unlit') {
      // the mark before it strikes: a faint ring and the horizon in pencil (L = its opacity here)
      ctx.globalAlpha *= L;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2.6; ctx.globalAlpha *= 0.32; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.75;
      ctx.beginPath(); ctx.arc(0, apex + Rp, Rp, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, apex + 6, R * 0.14, Math.PI, 0); ctx.stroke();
      ctx.restore(); ctx.restore(); return;
    }
    if (L <= 0) { ctx.restore(); return; }
    // disc
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.save(); ctx.clip();
    ctx.globalAlpha *= L;
    ctx.fillStyle = K.paper(ctx, '#F7F3EA', 9); ctx.fillRect(-R, -R, 2 * R, 2 * R);
    let g = ctx.createRadialGradient(-R * 0.4, -R * 0.5, 0, 0, 0, R * 1.2); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(90,60,30,0.14)');
    ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, 2 * R);
    // dawn haze in the sky
    ctx.save(); ctx.translate(0, apex); ctx.scale(2.6, 1); g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.6);
    g.addColorStop(0, 'rgba(240,160,110,0.55)'); g.addColorStop(0.5, 'rgba(242,201,176,0.25)'); g.addColorStop(1, 'rgba(242,201,176,0)'); ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, 2 * R); ctx.restore();
    // sun (behind the planet)
    ctx.fillStyle = C.clay; ctx.beginPath(); ctx.arc(0, apex - sunUp + 6, R * 0.14, 0, TAU); ctx.fill();
    // planet
    ctx.beginPath(); ctx.arc(0, apex + Rp, Rp, 0, TAU); ctx.fillStyle = '#16140F'; ctx.fill();
    g = ctx.createLinearGradient(0, apex, 0, R); g.addColorStop(0, 'rgba(240,160,110,0.25)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fill();
    // ink sketch lines on the planet (field-notebook texture)
    ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(244,241,234,0.12)'; ctx.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.arc(0, apex + Rp, Rp - k * 16, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); ctx.stroke(); }
    ctx.restore();
    ctx.restore();
    // rim light: lights from the centre outward on impact, brightest at the apex
    const rimU = (part === 'fav' ? 1 : E.out(seg(t, STRIKE, STRIKE + 0.55))) * L, span = 0.42 * rimU;
    if (span > 0.001) {
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, TAU); ctx.clip();
      const lg = ctx.createLinearGradient(-R, 0, R, 0);
      lg.addColorStop(0, 'rgba(255,215,181,0)'); lg.addColorStop(0.5, 'rgba(255,232,210,1)'); lg.addColorStop(1, 'rgba(255,215,181,0)');
      ctx.strokeStyle = lg; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(0, apex + Rp, Rp, -Math.PI / 2 - span, -Math.PI / 2 + span); ctx.stroke();
      ctx.restore();
      K.glow(ctx, 0, apex, R * 0.9, '#FFC9A0', 0.35 * rimU, { sy: 0.16 });
    }
    // outline ring
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.92 * L; ctx.stroke();
    ctx.restore();
  }

  // construction grid around the mark (logo geometry, ink sketch)
  function grid(ctx, t) {
    const a = 0.10 + 0.08 * K.env(t, 1.0, 1.4, 2.2, 3.0), R = M.R;
    ctx.save(); ctx.translate(M.x, M.y); ctx.strokeStyle = C.moon; ctx.globalAlpha = a; ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 7]); ctx.beginPath(); ctx.arc(0, 0, R * 1.42, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(-R * 1.9, 0); ctx.lineTo(R * 1.9, 0); ctx.moveTo(0, -R * 1.62); ctx.lineTo(0, R * 1.62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * 1.34, -R * 1.34); ctx.lineTo(R * 1.34, R * 1.34); ctx.moveTo(R * 1.34, -R * 1.34); ctx.lineTo(-R * 1.34, R * 1.34); ctx.stroke();
    // corner ticks of the bounding square
    const q = R * 1.18, l = 16;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.moveTo(sx * q, sy * (q - l)); ctx.lineTo(sx * q, sy * q); ctx.lineTo(sx * (q - l), sy * q); ctx.stroke(); }
    // a dimension arc with ticks, right side
    ctx.beginPath(); ctx.arc(0, 0, R * 1.62, -0.55, 0.55); ctx.stroke();
    for (let k = -5; k <= 5; k++) { const an = k * 0.1, r0 = R * 1.62, r1 = r0 + (k % 5 === 0 ? 14 : 7); ctx.beginPath(); ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0); ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); ctx.stroke(); }
    ctx.restore();
  }

  function lockup(ctx) {
    const size = 100, y = 830, sp = size * 0.24;
    const w1 = K.serifW(ctx, 'Logo', size), w2 = K.serifW(ctx, '+', size), w3 = K.serifW(ctx, 'jingle', size);
    const tot = w1 + w2 + w3 + sp * 2, x0 = 960 - tot / 2;
    K.serif(ctx, 'Logo', x0, y, size, { color: C.moon });
    K.serif(ctx, '+', x0 + w1 + sp, y, size, { color: C.clay });
    K.serif(ctx, 'jingle', x0 + w1 + w2 + sp * 2, y, size, { color: C.moon });
  }

  // the address bar the logo comes from: favicon, greeked URL, Firecrawl reading it
  function urlBar(ctx, env, t) {
    const { x, y, w, h } = URL, cy = y + h / 2;
    K.shadow(ctx, env, () => { K.rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = '#0B0C10'; ctx.fill(); }, { blur: 30, y: 12, color: 'rgba(0,0,0,0.6)' });
    K.rr(ctx, x, y, w, h, h / 2); ctx.strokeStyle = 'rgba(244,241,234,0.38)'; ctx.lineWidth = 1.4; ctx.stroke();
    // favicon: the logo itself, small and lit
    ctx.save(); ctx.translate(FAV[0], FAV[1]); ctx.scale(FAVR / M.R, FAVR / M.R); mark(ctx, env, t, 1, 'fav'); ctx.restore();
    ctx.beginPath(); ctx.arc(FAV[0], FAV[1], FAVR, 0, TAU); ctx.strokeStyle = 'rgba(244,241,234,0.85)'; ctx.lineWidth = 1.3; ctx.stroke();
    const grab = K.env(t, 0.72, 0.9, 1.05, 1.5);
    if (grab > 0) { ctx.save(); ctx.globalAlpha *= grab; ctx.beginPath(); ctx.arc(FAV[0], FAV[1], FAVR + 7, 0, TAU); ctx.strokeStyle = C.clay; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    // greeked URL
    ctx.fillStyle = 'rgba(244,241,234,0.42)'; K.rr(ctx, FAV[0] + 30, cy - 4, 170, 8, 4); ctx.fill();
    ctx.fillStyle = 'rgba(244,241,234,0.24)'; K.rr(ctx, FAV[0] + 212, cy - 4, 64, 8, 4); ctx.fill();
    // Firecrawl reads the page: its chip on the right, a shimmer runs back to the favicon
    const lh = 17, lw = 172 * lh / 40, fx = x + w - lw - 22;
    K.glow(ctx, fx + 9, cy, 46, '#FA5D19', 0.12 + 0.16 * K.env(t, 0.35, 0.5, 0.85, 1.2));
    K.firecrawl(ctx, fx, cy - lh / 2, lh);
    const sh = seg(t, 0.4, 0.86);
    if (sh > 0 && sh < 1) {
      ctx.save(); K.rr(ctx, x, y, w, h, h / 2); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
      const sx = lerp(fx, FAV[0] - 20, E.inOut(sh)), g = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
      g.addColorStop(0, 'rgba(255,190,150,0)'); g.addColorStop(0.5, 'rgba(255,190,150,0.26)'); g.addColorStop(1, 'rgba(255,190,150,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - 60, y, 120, h); ctx.restore();
    }
  }

  const ART = [
    { key: 'l5-ochre', tone: 'ochre', seed: 51, pts: [[-40, -40], [300, -40], [276, 96], [196, 170], [80, 206], [-40, 226]], torn: [false, true, true, true, true, false], sketch: 'compass', sx: 90, sy: 60, dim: 0.14 },
    { key: 'l5-zebra', tone: 'zebra', seed: 52, pts: [[1818, 330], [1960, 300], [1960, 660], [1838, 690]], torn: [true, false, true, true], sketch: 'none', dim: 0.3, stripe: -0.3 },
  ];

  K.loop(5, DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.4) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    grid(ctx, t);
    // sound rings on the beat
    for (const [b, k, acc] of BEATS) {
      const u = seg(t, b, b + 1.6); if (u <= 0 || u >= 1) continue;
      const r = M.R + 14 + (330 + 160 * acc) * E.out(u) * k;
      ctx.save(); ctx.globalAlpha = (acc ? 0.8 : 0.55) * Math.pow(1 - u, 1.6);
      ctx.beginPath(); ctx.arc(M.x, M.y, r, 0, TAU); ctx.strokeStyle = acc ? C.clay : C.moon; ctx.lineWidth = acc ? 3 : 2; ctx.stroke();
      ctx.restore();
    }
    // impact: shockwave + burst ticks + flash
    const sw = seg(t, STRIKE, STRIKE + 0.6);
    if (sw > 0 && sw < 1) {
      ctx.save(); ctx.globalAlpha = 0.6 * (1 - sw); ctx.beginPath(); ctx.arc(M.x, M.y, M.R * (1.05 + 0.9 * E.out(sw)), 0, TAU); ctx.strokeStyle = C.moon; ctx.lineWidth = 2.4; ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.8 * (1 - sw); ctx.strokeStyle = C.moon; ctx.lineWidth = 2.2;
      for (let k = 0; k < 12; k++) { const an = k * TAU / 12 + 0.13, r0 = M.R * (1.12 + 0.5 * E.out(sw)), r1 = r0 + 22 * (1 - sw); ctx.beginPath(); ctx.moveTo(M.x + Math.cos(an) * r0, M.y + Math.sin(an) * r0); ctx.lineTo(M.x + Math.cos(an) * r1, M.y + Math.sin(an) * r1); ctx.stroke(); }
      ctx.restore();
    }
    K.glow(ctx, M.x, M.y, M.R * 2.4, '#FFD7B5', 0.28 * K.env(t, STRIKE - 0.02, STRIKE + 0.04, STRIKE + 0.08, STRIKE + 0.6));
    // settle glow
    K.glow(ctx, M.x, M.y + M.R * 0.3, M.R * 2.2, C.clay, 0.07 * (t > STRIKE ? lit(t) : 0) * (0.8 + 0.2 * Math.sin(TAU * t / DUR * 2)));
    urlBar(ctx, env, t);
    // the mark: the outline waits at centre; the logo flies in from the address bar, growing, and strikes onto it
    const L = lit(t), fly = seg(t, GRAB, STRIKE), q = E.in(fly);
    const squash = t >= STRIKE ? -0.035 * Math.sin(Math.PI * seg(t, STRIKE, STRIKE + 0.28)) : 0;
    ctx.save(); ctx.translate(M.x, M.y);
    ctx.save(); const s0 = 1 + pulse(t); ctx.scale(s0, s0); mark(ctx, env, t, outlineA(t), 'unlit'); ctx.restore();
    ctx.restore();
    if (L > 0) {
      const path = P.bez(FAV, [FAV[0] - 40, FAV[1] + 170], [M.x - 160, M.y - 40], [M.x, M.y], 40);
      const [x, y] = t < STRIKE ? P.at(path, q) : [M.x, M.y];
      const k = t < STRIKE ? lerp(FAVR / M.R, 1, q) : 1 + squash + pulse(t);
      if (t < STRIKE) K.dots(ctx, path, { from: Math.max(0, q - 0.3), to: q, gap: 12, r: 1.8, alpha: 0.4 });
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); mark(ctx, env, t, L, 'lit'); ctx.restore();
    }
    lockup(ctx);
  });
})();
