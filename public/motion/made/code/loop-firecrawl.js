/* Firecrawl · "URL in. Brand out."
 * set-up : a URL is typed into an address bar that carries the Firecrawl chip ("URL in.")
 * turn   : the page loads; the real Firecrawl flame scans it top to bottom and marks the logo, the type and the colours
 * pay-off: the logo, three brand colours and the type specimen fly out and settle into a clean brand card ("Brand out.")
 * The brand grabbed is Glaido (Jack's own): real wordmark, real colours (lime, ink, paper). At most 3 words per frame
 * (caption + the typed URL). Everything eases back to the empty template, so the loop is a cycle. */
(function () {
  const K = window.STORY_KIT, C = K.C, E = K.ease, P = K.P, lerp = K.lerp, seg = K.seg, TAU = K.TAU;
  const DUR = 10;
  // Glaido wordmark: first two paths = lime G mark
  const GLAIDO = ["M65.9202 27.3358H29.9063C28.5227 27.3358 27.401 28.4546 27.401 29.8348V38.5815C27.401 39.9617 28.5227 41.0805 29.9063 41.0805H66.2274C67.3794 41.0805 68.3372 41.9653 68.4255 43.111V65.7586C68.4255 67.1388 69.5472 68.2577 70.9308 68.2577H79.5429C80.9265 68.2577 82.0482 67.1388 82.0482 65.7586V43.5796C82.0482 42.1994 80.9265 41.0805 79.5429 41.0805H71.0874C69.6173 41.0805 68.4255 39.8917 68.4255 38.4253V29.8348C68.4255 28.4546 67.3039 27.3358 65.9202 27.3358Z","M54.9604 65.9124V57.1657C54.9604 55.7855 53.8387 54.6667 52.455 54.6667H23.3307C17.9691 54.6667 13.6227 50.3311 13.6227 44.9829V17.4933C13.6227 15.4231 15.3052 13.7448 17.3806 13.7448H65.7645C67.1482 13.7448 68.2698 12.6259 68.2698 11.2457V2.49905C68.2698 1.11886 67.1482 0 65.7645 0H17.5372C7.85167 0 0 7.83203 0 17.4933V45.3504C0 51.3155 2.37557 57.0363 6.60411 61.2543L27.4019 82V70.9105C27.4019 69.5303 28.5236 68.4114 29.9072 68.4114H52.455C53.8387 68.4114 54.9604 67.2926 54.9604 65.9124Z","M100.732 34.3801C100.732 28.03 101.975 22.4056 104.46 17.507C106.946 12.6084 110.493 8.82857 115.101 6.16758C119.708 3.44612 125.044 2.08539 131.107 2.08539C138.14 2.08539 144.021 3.99041 148.75 7.80046C153.539 11.6105 156.54 16.7813 157.753 23.3128H149.932C148.719 18.898 146.446 15.481 143.111 13.062C139.777 10.5824 135.714 9.34262 130.925 9.34262C126.56 9.34262 122.679 10.401 119.284 12.5177C115.949 14.6344 113.373 17.5977 111.554 21.4078C109.735 25.2178 108.826 29.5419 108.826 34.3801C108.826 39.2182 109.735 43.5423 111.554 47.3524C113.373 51.1624 115.949 54.1258 119.284 56.2425C122.619 58.3592 126.438 59.4175 130.743 59.4175C134.623 59.4175 138.079 58.6918 141.11 57.2404C144.202 55.7285 146.597 53.6118 148.295 50.8903C150.053 48.1084 150.932 44.8728 150.932 41.1837V39.0066H131.834V31.7493H158.662V66.1305H152.114L151.296 56.0611C149.538 58.9035 146.9 61.3831 143.384 63.4997C139.867 65.6164 135.623 66.6748 130.652 66.6748C124.832 66.6748 119.648 65.314 115.101 62.5926C110.554 59.8711 107.007 56.0913 104.46 51.2532C101.975 46.3545 100.732 40.7302 100.732 34.3801Z","M168.127 2.62968H175.584V66.1305H168.127V2.62968Z","M229.428 59.3268V66.1305H225.336C222.365 66.1305 220.243 65.5257 218.97 64.3162C217.696 63.1066 217.03 61.3226 216.969 58.964C213.392 64.1045 208.208 66.6748 201.418 66.6748C196.264 66.6748 192.111 65.4652 188.958 63.0462C185.866 60.6271 184.32 57.3311 184.32 53.1582C184.32 48.5014 185.897 44.9333 189.049 42.4538C192.263 39.9742 196.901 38.7344 202.964 38.7344H216.605V35.5594C216.605 32.5355 215.574 30.1769 213.513 28.4836C211.512 26.7902 208.693 25.9435 205.055 25.9435C201.842 25.9435 199.174 26.6693 197.052 28.1207C194.991 29.5117 193.718 31.3865 193.233 33.7451H185.775C186.321 29.2093 188.322 25.6714 191.778 23.1314C195.294 20.5913 199.841 19.3213 205.419 19.3213C211.361 19.3213 215.938 20.7728 219.152 23.6757C222.425 26.5786 224.062 30.7212 224.062 36.1036V55.1541C224.062 57.9361 225.366 59.3268 227.973 59.3268H229.428ZM216.605 45.1753H202.237C196.719 45.1753 193.96 47.2315 193.96 51.3437C193.96 53.2185 194.688 54.7304 196.143 55.8796C197.658 57.0288 199.689 57.6034 202.237 57.6034C206.237 57.6034 209.39 56.5451 211.694 54.4284C213.998 52.2513 215.15 49.3787 215.15 45.8103L216.605 45.1753Z","M239.138 1.99467C240.532 1.99467 241.684 2.44825 242.594 3.35539C243.563 4.26255 244.049 5.41174 244.049 6.80295C244.049 8.19417 243.563 9.34332 242.594 10.2505C241.684 11.1577 240.532 11.6112 239.138 11.6112C237.744 11.6112 236.562 11.1577 235.592 10.2505C234.683 9.34332 234.228 8.19417 234.228 6.80295C234.228 5.41174 234.683 4.26255 235.592 3.35539C236.562 2.44825 237.744 1.99467 239.138 1.99467ZM235.319 19.8656H242.776V66.1305H235.319V19.8656Z","M295.28 2.62968V66.1305H288.823L287.823 58.6918C283.943 64.0137 278.608 66.6748 271.817 66.6748C267.573 66.6748 263.8 65.7064 260.495 63.7704C257.19 61.8344 254.584 59.0412 252.675 55.3904C250.826 51.7396 249.902 47.4758 249.902 42.5976C249.902 37.8619 250.826 33.6879 252.675 30.0762C254.584 26.4644 257.19 23.6726 260.495 21.7005C263.8 19.7284 267.573 18.7423 271.817 18.7423C275.272 18.7423 278.275 19.4077 280.822 20.7384C283.37 22.0692 285.355 23.9235 286.778 26.3013V2.62968H295.28ZM272.726 60.0525C275.515 60.0525 277.972 59.3571 280.1 57.9664C282.286 56.5756 283.957 54.6698 285.114 52.2489C286.33 49.7677 286.938 46.9435 286.938 43.7766V42.6844C286.938 39.5175 286.33 36.7243 285.114 34.3044C283.957 31.8237 282.286 29.9185 280.1 28.5885C277.972 27.1974 275.515 26.5018 272.726 26.5018C268.482 26.5018 265.056 28.0247 262.449 31.0705C259.902 34.1164 258.628 38.1144 258.628 43.0643C258.628 48.0142 259.902 52.0122 262.449 55.0581C265.056 58.0435 268.482 60.0525 272.726 60.0525Z","M324.991 66.6748C320.505 66.6748 316.503 65.6769 312.987 63.6814C309.531 61.6253 306.833 58.7828 304.893 55.1541C303.014 51.4648 302.075 47.231 302.075 42.4538C302.075 37.6766 303.014 33.4692 304.893 29.8316C306.833 26.1334 309.531 23.2819 312.987 21.2772C316.503 19.2724 320.505 18.27 324.991 18.27C329.478 18.27 333.449 19.2724 336.904 21.2772C340.421 23.2819 343.12 26.1334 344.999 29.8316C346.938 33.4692 347.908 37.6766 347.908 42.4538C347.908 47.231 346.938 51.4648 344.999 55.1541C343.12 58.7828 340.421 61.6253 336.904 63.6814C333.449 65.6769 329.478 66.6748 324.991 66.6748ZM324.991 59.9433C327.901 59.9433 330.448 59.2176 332.63 57.7662C334.874 56.3147 336.601 54.3191 337.813 51.7791C339.087 49.1786 339.723 46.2458 339.723 42.9803C339.723 39.7148 339.087 36.8120 337.813 34.2719C336.601 31.6714 334.874 29.6456 332.63 28.1943C330.448 26.7428 327.901 26.0171 324.991 26.0171C322.081 26.0171 319.504 26.7428 317.261 28.1943C315.078 29.6456 313.351 31.6714 312.078 34.2719C310.866 36.8120 310.259 39.7148 310.259 42.9803C310.259 46.2458 310.866 49.1786 312.078 51.7791C313.351 54.3191 315.078 56.3147 317.261 57.7662C319.504 59.2176 322.081 59.9433 324.991 59.9433Z"];
  const G = { lime: '#BFF549', ink: '#27221D', paper: '#F0ECE2' };
  const gpath = {}; const gp = d => gpath[d] || (gpath[d] = new Path2D(d));
  function glaido(ctx, x, y, h, letters = G.ink, a = 1) {                 // left/top at x,y, height h
    const s = h / 82; ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= a;
    GLAIDO.forEach((d, i) => { ctx.fillStyle = i < 2 ? G.lime : letters; ctx.fill(gp(d)); });
    ctx.restore(); return 348 * s;
  }

  const BAR = { w: 860, h: 76 }; BAR.x = 960 - BAR.w / 2; BAR.y = 284;
  const URL_TEXT = 'glaido.com';
  const PG = { x: 300, y: 432, w: 740, h: 456, top: 30 };                 // the page preview
  const BC = { x: 1122, y: 432, w: 500, h: 456 };                          // the brand card
  const SW = [[G.lime, '#BFF549'], [G.ink, '#27221D'], [G.paper, '#F0ECE2']];
  const swAt = i => [BC.x + 96 + i * 154, BC.y + 214];
  const FONT_AT = [BC.x + 44, BC.y + 402], FONT_SIZE = 92;
  const LOGO_PAGE = [PG.x + 30, PG.y + PG.top + 22, 24], LOGO_CARD = [BC.x + 44, BC.y + 50, 46];

  // ---- beats
  const typed = t => (t < 5 ? Math.floor(URL_TEXT.length * seg(t, 0.45, 1.55)) : URL_TEXT.length - Math.floor(URL_TEXT.length * seg(t, 9.05, 9.6)));
  const pageA = t => E.inOut(seg(t, 1.9, 2.75)) * (1 - E.inOut(seg(t, 8.6, 9.5)));
  const scanU = t => E.inOut(seg(t, 2.7, 4.3));
  const cardA = t => E.inOut(seg(t, 4.2, 4.95)) * (1 - E.inOut(seg(t, 8.45, 9.3)));
  const FLY = { logo: 4.6, lime: 4.9, ink: 5.1, paper: 5.3, font: 5.5 };
  const fly = (t, k) => E.inOut(seg(t, FLY[k], FLY[k] + 0.72));
  const landed = (t, k) => fly(t, k) >= 1 ? 1 - E.inOut(seg(t, 8.4, 8.95)) : 0;
  const hit = (t, y) => { const sy = lerp(PG.y + PG.top + 6, PG.y + PG.h - 6, scanU(t)); return sy >= y ? 1 : 0; };   // has the scan passed y?

  function caption(ctx, t) {
    const a1 = K.env(t, 0.15, 0.7, 2.6, 3.1), a2 = K.env(t, 5.25, 5.85, 8.25, 8.75);
    if (a1 > 0) K.serif(ctx, 'URL in.', 960, 236 + 12 * (1 - a1), 96, { color: C.moon, alpha: a1, align: 'center' });
    if (a2 > 0) K.serif(ctx, 'Brand out.', 960, 236 + 12 * (1 - a2), 96, { color: C.moon, alpha: a2, align: 'center' });
  }

  function addressBar(ctx, env, t) {
    const { x, y, w, h } = BAR, cy = y + h / 2, sub = K.env(t, 1.85, 1.95, 2.1, 2.6), scanning = K.env(t, 2.6, 2.8, 4.2, 4.5);
    K.shadow(ctx, env, () => { K.rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = '#0B0C10'; ctx.fill(); }, { blur: 36, y: 14, color: 'rgba(0,0,0,0.6)' });
    K.rr(ctx, x, y, w, h, h / 2); ctx.strokeStyle = `rgba(244,241,234,${0.36 + 0.3 * sub})`; ctx.lineWidth = 1.5; ctx.stroke();
    // lock
    ctx.strokeStyle = 'rgba(244,241,234,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x + 30, cy - 4, 18, 14, 3); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 39, cy - 5, 6, Math.PI, 0); ctx.stroke();
    // typed URL + caret (types in, blinks while idle, is deleted before the loop point)
    const n = typed(t), str = URL_TEXT.slice(0, n), tx = x + 70, size = 32;
    if (n > 0) K.sans(ctx, str, tx, cy + 11, size, { weight: 500, track: 0.005, color: C.moon });
    const cw = n > 0 ? K.sansW(ctx, str, size, { weight: 500, track: 0.005 }) : 0;
    const typing = K.env(t, 0.3, 0.42, 1.6, 1.8) + K.env(t, 8.95, 9.05, 9.6, 9.75);
    const blink = 0.5 + 0.5 * Math.cos(TAU * 1.2 * t), vis = 1 - K.env(t, 1.85, 2.2, 8.75, 8.95);
    const ca = vis * lerp(blink, 1, Math.min(1, typing));
    if (ca > 0.01) { ctx.fillStyle = K.rgba(C.clay, ca); ctx.fillRect(tx + cw + 4, cy - 20, 3, 40); }
    // Firecrawl chip, glowing while it works
    const lh = 24, lw = 172 * lh / 40, fx = x + w - lw - 30;
    K.glow(ctx, fx + 12, cy, 60, '#FA5D19', 0.1 + 0.3 * Math.max(sub, scanning));
    K.firecrawl(ctx, fx, cy - lh / 2, lh);
  }

  // ---- the page (Glaido, greeked copy) and what Firecrawl marks on it
  function page(ctx, env, t) {
    const a = pageA(t), { x, y, w, h, top } = PG;
    // empty template frame (always there, faint)
    ctx.save(); ctx.setLineDash([6, 8]); K.rr(ctx, x, y, w, h, 14); ctx.strokeStyle = `rgba(244,241,234,${0.16 * (1 - a)})`; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, 16 * (1 - a));
    K.shadow(ctx, env, () => { K.rr(ctx, x, y, w, h, 14); ctx.fillStyle = G.paper; ctx.fill(); }, { blur: 60, y: 26, color: 'rgba(0,0,0,0.65)' });
    ctx.save(); K.rr(ctx, x, y, w, h, 14); ctx.clip();
    ctx.fillStyle = K.paper(ctx, G.paper, 12); ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#E4DDCD'; ctx.fillRect(x, y, w, top);
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + 20 + k * 16, y + top / 2, 4.5, 0, TAU); ctx.fillStyle = 'rgba(39,34,29,0.22)'; ctx.fill(); }
    // nav
    const ly = y + top + 22;
    glaido(ctx, LOGO_PAGE[0], ly, LOGO_PAGE[2]);                                    // the page keeps its logo: Firecrawl copies it
    ctx.fillStyle = 'rgba(39,34,29,0.3)'; for (let k = 0; k < 3; k++) { K.rr(ctx, x + w - 250 + k * 78, ly + 8, 56, 7, 3.5); ctx.fill(); }
    // hero copy (greeked), button, voice-wave illustration
    ctx.fillStyle = G.ink; K.rr(ctx, x + 30, y + 132, 360, 22, 6); ctx.fill(); K.rr(ctx, x + 30, y + 166, 286, 22, 6); ctx.fill();
    ctx.fillStyle = 'rgba(39,34,29,0.32)'; K.rr(ctx, x + 30, y + 212, 320, 8, 4); ctx.fill(); K.rr(ctx, x + 30, y + 230, 240, 8, 4); ctx.fill();
    K.rr(ctx, x + 30, y + 268, 150, 44, 22); ctx.fillStyle = G.lime; ctx.fill();
    ctx.strokeStyle = G.ink; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x + 92, y + 290); ctx.lineTo(x + 118, y + 290); ctx.stroke(); K.arrow(ctx, x + 119, y + 290, 0, { size: 7, w: 2.4, color: G.ink });
    const wx = x + 470, wy = y + 200;
    ctx.beginPath(); ctx.arc(wx + 110, wy, 118, 0, TAU); ctx.fillStyle = '#E7E0D0'; ctx.fill();
    for (const [amp, col, lw2] of [[1, G.ink, 3], [0.6, G.lime, 5]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw2; ctx.beginPath();
      for (let k = 0; k <= 60; k++) { const u = k / 60, px = wx + 20 + u * 180, py = wy + Math.sin(u * TAU * 2.2 + TAU * t / DUR * 2) * 34 * amp * Math.sin(Math.PI * u); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
    }
    // feature cards
    for (let k = 0; k < 3; k++) { const cx = x + 30 + k * 232; K.rr(ctx, cx, y + 350, 212, 80, 10); ctx.fillStyle = '#E7E0D0'; ctx.fill(); ctx.beginPath(); ctx.arc(cx + 26, y + 376, 8, 0, TAU); ctx.fillStyle = G.lime; ctx.fill(); ctx.fillStyle = 'rgba(39,34,29,0.3)'; K.rr(ctx, cx + 18, y + 398, 130, 7, 3.5); ctx.fill(); }
    ctx.restore();
    ctx.restore();
  }
  // Firecrawl's marks: dashed brackets around what it found, dropped as each element leaves for the card
  function marks(ctx, t) {
    const a = pageA(t), x = PG.x, y = PG.y;
    const box = (bx, by, bw, bh, on) => { if (on <= 0) return; ctx.save(); ctx.globalAlpha *= on * a; ctx.setLineDash([5, 5]); K.rr(ctx, bx, by, bw, bh, 8); ctx.strokeStyle = C.clay; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore(); };
    const on = (yy, k) => hit(t, yy) * (1 - E.inOut(seg(t, FLY[k], FLY[k] + 0.3))) * (t < 8.4 ? 1 : 0);
    box(x + 22, y + PG.top + 14, 102, 40, on(y + PG.top + 14, 'logo'));
    box(x + 22, y + 124, 376, 72, on(y + 124, 'font'));
    box(x + 22, y + 260, 166, 60, on(y + 260, 'lime'));
    // sample dots for ink and paper
    const dot = (px, py, k) => { const v = on(py, k); if (v <= 0) return; ctx.save(); ctx.globalAlpha *= v * a; ctx.beginPath(); ctx.arc(px, py, 11, 0, TAU); ctx.strokeStyle = C.clay; ctx.lineWidth = 1.8; ctx.stroke(); ctx.beginPath(); ctx.moveTo(px - 16, py); ctx.lineTo(px - 6, py); ctx.moveTo(px + 6, py); ctx.lineTo(px + 16, py); ctx.stroke(); ctx.restore(); };
    dot(x + 250, y + 143, 'ink'); dot(x + 640, y + 330, 'paper');
  }
  function scanner(ctx, t) {
    const a = K.env(t, 2.55, 2.75, 4.25, 4.5); if (a <= 0) return;
    const sy = lerp(PG.y + PG.top + 6, PG.y + PG.h - 6, scanU(t)), x0 = PG.x - 20, x1 = PG.x + PG.w + 16;
    ctx.save(); ctx.globalAlpha *= a;
    const g = ctx.createLinearGradient(0, sy - 30, 0, sy + 4); g.addColorStop(0, 'rgba(217,119,87,0)'); g.addColorStop(1, 'rgba(217,119,87,0.22)');
    ctx.fillStyle = g; ctx.fillRect(PG.x, sy - 30, PG.w, 34);
    ctx.fillStyle = C.clay; ctx.fillRect(x0, sy - 1.2, x1 - x0, 2.4);
    // the flame rides the scan line on a small dark tab
    K.rr(ctx, x0 - 50, sy - 22, 50, 44, 22); ctx.fillStyle = '#0B0C10'; ctx.fill(); ctx.strokeStyle = 'rgba(244,241,234,0.34)'; ctx.lineWidth = 1.3; ctx.stroke();
    K.glow(ctx, x0 - 25, sy, 46, '#FA5D19', 0.3);
    K.firecrawl(ctx, x0 - 25 - 14 * 0.7, sy - 14, 28, { mark: true });
    ctx.restore();
  }

  // ---- the brand card and the flights into it
  function card(ctx, env, t) {
    const a = cardA(t), { x, y, w, h } = BC;
    ctx.save(); ctx.setLineDash([6, 8]); K.rr(ctx, x, y, w, h, 16); ctx.strokeStyle = `rgba(244,241,234,${0.16 * (1 - a)})`; ctx.lineWidth = 1.4; ctx.stroke();
    // empty slots of the template
    ctx.globalAlpha = 0.14 * (1 - a); ctx.strokeStyle = C.moon;
    for (let i = 0; i < 3; i++) { const [sx, sy] = swAt(i); ctx.beginPath(); ctx.arc(sx, sy, 38, 0, TAU); ctx.stroke(); }
    ctx.restore();
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, 18 * (1 - a));
    K.shadow(ctx, env, () => { K.rr(ctx, x, y, w, h, 16); ctx.fillStyle = C.ivory; ctx.fill(); }, { blur: 70, y: 30, color: 'rgba(0,0,0,0.7)' });
    K.rr(ctx, x, y, w, h, 16); ctx.fillStyle = K.paper(ctx, C.ivory, 13); ctx.fill();
    ctx.fillStyle = 'rgba(20,20,19,0.1)'; ctx.fillRect(x + 36, y + 128, w - 72, 1.2); ctx.fillRect(x + 36, y + 318, w - 72, 1.2);
    // slots (faint) until each item lands
    ctx.strokeStyle = 'rgba(20,20,19,0.14)'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 5]);
    for (let i = 0; i < 3; i++) { const [sx, sy] = swAt(i); ctx.beginPath(); ctx.arc(sx, sy, 38, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.restore();
    // landed items
    const L = k => landed(t, k) * a;
    if (L('logo') > 0) glaido(ctx, LOGO_CARD[0], LOGO_CARD[1], LOGO_CARD[2], G.ink, L('logo'));
    ['lime', 'ink', 'paper'].forEach((k, i) => { const v = L(k); if (v <= 0) return; swatch(ctx, i, swAt(i)[0], swAt(i)[1], 1, v); K.sans(ctx, SW[i][1], swAt(i)[0], swAt(i)[1] + 70, 17, { weight: 500, track: 0.06, align: 'center', color: C.ink, alpha: 0.62 * v }); });
    if (L('font') > 0) {
      K.sans(ctx, 'Aa', FONT_AT[0], FONT_AT[1], FONT_SIZE, { weight: 700, track: -0.02, color: C.ink, alpha: L('font') });
      ctx.fillStyle = `rgba(20,20,19,${0.5 * L('font')})`; K.rr(ctx, BC.x + 232, BC.y + 346, 220, 16, 5); ctx.fill(); K.rr(ctx, BC.x + 232, BC.y + 374, 170, 11, 4); ctx.fill(); K.rr(ctx, BC.x + 232, BC.y + 396, 196, 7, 3.5); ctx.fill();
    }
  }
  function swatch(ctx, i, x, y, s, a) {
    ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, 38 * s, 0, TAU); ctx.fillStyle = SW[i][0]; ctx.fill();
    if (i === 2) { ctx.strokeStyle = 'rgba(20,20,19,0.25)'; ctx.lineWidth = 1.3; ctx.stroke(); }
    const hl = ctx.createRadialGradient(x - 12 * s, y - 14 * s, 0, x, y, 38 * s); hl.addColorStop(0, 'rgba(255,255,255,0.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hl; ctx.fill();
    ctx.restore();
  }
  function flights(ctx, t) {
    const arc = (from, to, u, lift = 120) => P.at(P.bez(from, [lerp(from[0], to[0], 0.35), Math.min(from[1], to[1]) - lift], [lerp(from[0], to[0], 0.7), Math.min(from[1], to[1]) - lift], to, 30), u);
    const trail = (from, to, u, lift) => K.dots(ctx, P.bez(from, [lerp(from[0], to[0], 0.35), Math.min(from[1], to[1]) - lift], [lerp(from[0], to[0], 0.7), Math.min(from[1], to[1]) - lift], to, 30), { from: Math.max(0, u - 0.25), to: u, gap: 12, r: 1.8, alpha: 0.45 });
    const f = k => fly(t, k), live = k => f(k) > 0 && f(k) < 1;
    if (live('logo')) {
      const u = f('logo'), from = [LOGO_PAGE[0], PG.y + PG.top + 22], to = [LOGO_CARD[0], LOGO_CARD[1]];
      trail(from, to, u, 140); const [px, py] = arc(from, to, u, 140); glaido(ctx, px, py, lerp(LOGO_PAGE[2], LOGO_CARD[2], u), G.ink);
    }
    const srcs = { lime: [PG.x + 105, PG.y + 290], ink: [PG.x + 250, PG.y + 143], paper: [PG.x + 640, PG.y + 330] };
    ['lime', 'ink', 'paper'].forEach((k, i) => { if (!live(k)) return; const u = f(k), to = swAt(i); trail(srcs[k], to, u, 110); const [px, py] = arc(srcs[k], to, u, 110); swatch(ctx, i, px, py, lerp(0.35, 1, u), 1); });
    if (live('font')) {
      const u = f('font'), from = [PG.x + 30, PG.y + 188], to = FONT_AT;
      trail(from, to, u, 90); const [px, py] = arc(from, to, u, 90);
      K.sans(ctx, 'Aa', px, py, lerp(46, FONT_SIZE, u), { weight: 700, track: -0.02, color: C.moon });
    }
  }

  const ART = [
    { key: 'fc-ochre', tone: 'ochre', seed: 111, pts: [[-40, -40], [300, -40], [276, 96], [196, 170], [-40, 206]], torn: [false, true, true, true, false], sketch: 'compass', sx: 104, sy: 58, dim: 0.14 },
    { key: 'fc-zebra', tone: 'zebra', seed: 112, pts: [[1800, 860], [1960, 836], [1960, 1120], [1846, 1120]], torn: [true, false, false, true], sketch: 'none', dim: 0.3, stripe: 0.5 },
  ];

  K.loop('firecrawl', DUR, (ctx, t, env) => {
    const p = env.p;
    ART.forEach((a, i) => { ctx.save(); ctx.translate(Math.sin(TAU * p + i * 2.2) * 4, Math.cos(TAU * p + i) * 3); K.torn(ctx, env, a); ctx.restore(); });
    caption(ctx, t);
    page(ctx, env, t);
    marks(ctx, t);
    scanner(ctx, t);
    card(ctx, env, t);
    flights(ctx, t);
    addressBar(ctx, env, t);
  });
})();
