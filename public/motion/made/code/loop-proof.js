/* Proof · Opus 5.5 in one graphic (replaces the deck's benchmark charts)
 * beat 1: the Opus 5.5 bar rises to the Fable 5.1 line: "Fable 5.1 level, on most work" (no Opus 5 row shown)
 * beat 2: the Opus 5 row appears as the base; Opus 5.5 drops to 60% of it: "40% cheaper, vs Opus 5"
 * beat 3: Opus 5.5 runs past the Opus 5 end: "30%+ faster, vs Opus 5"
 * Facts (RULES.md): 40% and 30% are against Opus 5, never against Fable; "more than 30% faster" is shown as 30%+.
 * Linear bars from zero. At most 6 words on screen in any beat. */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10, OFFSET = 1.9;                            // t = 0 opens on beat 1's pay-off
  const X0 = 560, U = 800, BH = 46;                        // bar origin, px per 100%, bar height
  const R1 = 594, R2 = 744;                                 // row centres: Opus 5.5, Opus 5
  const X100 = X0 + U, ANN = 420;                           // the 100% line, annotation baseline

  // story time: s in [0, 10)
  function state(s) {
    const lvl = E.out(seg(s, 0.25, 1.45));                                   // beat 1: 0 -> 100
    const toCost = E.inOut(seg(s, 3.3, 4.0)), toSpeed = E.inOut(seg(s, 6.1, 7.1)), reset = E.inOut(seg(s, 8.9, 9.6));
    let b1 = s < 3.3 ? lvl : s < 6.1 ? lerp(1, 0.6, toCost) : s < 8.9 ? lerp(0.6, 1.3, toSpeed) : lerp(1.3, 0, reset);
    const b2 = s < 3.1 ? 0 : s < 8.9 ? E.out(seg(s, 3.1, 3.95)) : 1 - reset;
    const row2 = s < 8.9 ? E.inOut(seg(s, 2.95, 3.4)) : 1 - E.inOut(seg(s, 9.15, 9.7));
    return {
      b1, b2, row2,
      marker: K.env(s, 0.0, 0.55, 3.0, 3.45),
      contact: K.env(s, 1.3, 1.42, 1.6, 2.6),
      a1: K.env(s, 0.2, 0.8, 2.95, 3.35),
      gap: K.env(s, 3.85, 4.35, 5.95, 6.35),
      a2: K.env(s, 3.9, 4.35, 5.95, 6.4), n2: Math.round(40 * E.out(seg(s, 3.9, 4.8))),
      guide: K.env(s, 6.05, 6.5, 8.8, 9.3),
      a3: K.env(s, 6.7, 7.2, 8.8, 9.25), n3: Math.round(30 * E.out(seg(s, 6.7, 7.6))), plus: E.out(seg(s, 7.5, 7.8)),
    };
  }

  function label(ctx, name, y, a, lead) {
    if (a <= 0) return;
    const size = 54, w = K.serifW(ctx, name, size);
    K.serif(ctx, name, X0 - 38, y + 18, size, { color: C.moon, alpha: a, align: 'right' });
    K.claudeMark(ctx, X0 - 38 - w - 34, y, 32, lead ? C.clay : 'rgba(244,241,234,0.55)', a);
  }
  function track(ctx, y, a) {
    if (a <= 0) return;
    K.rr(ctx, X0, y - BH / 2, U * 1.38, BH, BH / 2); ctx.fillStyle = `rgba(244,241,234,${0.06 * a})`; ctx.fill();
  }
  function bar(ctx, y, v, lead, a = 1) {
    if (v <= 0.002 || a <= 0) return;
    const w = Math.max(BH, U * v);
    ctx.save(); ctx.globalAlpha *= a;
    K.rr(ctx, X0, y - BH / 2, w, BH, BH / 2);
    if (lead) {
      const g = ctx.createLinearGradient(X0, 0, X0 + w, 0);
      g.addColorStop(0, C.clay2); g.addColorStop(Math.min(1, U / w), C.clay); g.addColorStop(1, '#F0A27C');
      ctx.fillStyle = g;
    } else ctx.fillStyle = 'rgba(244,241,234,0.52)';
    ctx.fill();
    // a soft top light so the bar reads as a lit object, not a flat rectangle
    const hl = ctx.createLinearGradient(0, y - BH / 2, 0, y + BH / 2); hl.addColorStop(0, 'rgba(255,255,255,0.16)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = hl; ctx.fill();
    ctx.restore();
  }
  // a big clay number + serif word, right-aligned number slot so the count never jitters, small caps tag beneath
  function annotate(ctx, cx, num, fullNum, word, tag, a, plus = 0) {
    if (a <= 0) return;
    const y = ANN + 14 * (1 - a), nS = 150, wS = 70, sp = 24;
    const nW = K.serifW(ctx, fullNum, nS), pW = plus ? K.serifW(ctx, '+', nS) : 0, wW = word ? K.serifW(ctx, word, wS) : 0;
    const tot = nW + pW + (word ? sp + wW : 0), x0 = cx - tot / 2;
    ctx.save(); ctx.globalAlpha *= a;
    K.serif(ctx, num, x0 + nW, y, nS, { color: C.clay, align: 'right' });
    if (plus) K.serif(ctx, '+', x0 + nW, y, nS, { color: C.clay, alpha: plus });
    if (word) K.serif(ctx, word, x0 + nW + pW + sp, y, wS, { color: C.moon });
    if (tag) K.sans(ctx, tag, cx, y + 56, 25, { weight: 600, caps: true, track: 0.16, align: 'center', color: C.moon, alpha: 0.82 });
    ctx.restore();
  }

  const ART = [
    { key: 'pf-ochre', tone: 'ochre', seed: 81, pts: [[-40, -40], [320, -40], [294, 104], [210, 184], [-40, 226]], torn: [false, true, true, true, false], sketch: 'compass', sx: 110, sy: 64, dim: 0.14 },
    { key: 'pf-zebra', tone: 'zebra', seed: 82, pts: [[1780, 820], [1960, 796], [1960, 1120], [1830, 1120]], torn: [true, false, false, true], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop('proof', DUR, (ctx, t, env) => {
    const p = env.p, s = (t + OFFSET) % DUR, S = state(s);
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.2) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    // zero axis
    ctx.fillStyle = 'rgba(244,241,234,0.3)'; ctx.fillRect(X0 - 1, R1 - BH / 2 - 26, 1.6, (R2 - R1) + BH + 52);
    // rows
    label(ctx, 'Opus 5.5', R1, 1, true);
    label(ctx, 'Opus 5', R2, S.row2, false);
    track(ctx, R1, 1); track(ctx, R2, S.row2);
    // beat 2: the saved 40%, outlined where the cost used to be
    if (S.gap > 0) {
      ctx.save(); ctx.globalAlpha *= S.gap; ctx.setLineDash([7, 7]); ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(244,241,234,0.7)';
      K.rr(ctx, X0 + U * 0.6 - BH / 2, R1 - BH / 2, U * 0.4 + BH / 2, BH, BH / 2); ctx.stroke(); ctx.restore();
    }
    bar(ctx, R2, S.b2, false, S.row2);
    bar(ctx, R1, S.b1, true);
    // beat 3: where Opus 5 ends, through both rows
    if (S.guide > 0) {
      ctx.save(); ctx.globalAlpha *= S.guide; ctx.setLineDash([5, 7]); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(244,241,234,0.7)';
      ctx.beginPath(); ctx.moveTo(X100, R1 - BH / 2 - 18); ctx.lineTo(X100, R2 + BH / 2 + 18); ctx.stroke(); ctx.restore();
    }
    // beat 1: the Fable 5.1 level line, the bar lands on it
    if (S.marker > 0) {
      const top = ANN + 76, bot = R1 + BH / 2 + 22;
      ctx.save(); ctx.setLineDash([6, 7]); ctx.lineWidth = 2; ctx.strokeStyle = K.mix('#F4F1EA', C.clay, S.contact, 0.85 * S.marker);
      ctx.beginPath(); ctx.moveTo(X100, top); ctx.lineTo(X100, lerp(top, bot, E.inOut(Math.min(1, S.marker * 1.2)))); ctx.stroke(); ctx.restore();
      K.glow(ctx, X100, R1, 90, '#FFD7B5', 0.35 * S.contact);
    }
    if (S.a1 > 0) {
      const y = ANN + 14 * (1 - S.a1);
      K.serif(ctx, 'Fable 5.1 level', X100, y, 80, { color: C.moon, alpha: S.a1, align: 'center' });
      K.sans(ctx, 'on most work', X100, y + 52, 25, { weight: 600, caps: true, track: 0.16, align: 'center', color: C.moon, alpha: 0.82 * S.a1 });
    }
    annotate(ctx, X0 + U * 0.8, `${S.n2}%`, '40%', 'cheaper', 'vs Opus 5', S.a2);
    annotate(ctx, X0 + U * 1.15, `${S.n3}%`, '30%', 'faster', 'vs Opus 5', S.a3, S.plus);
  });
})();
