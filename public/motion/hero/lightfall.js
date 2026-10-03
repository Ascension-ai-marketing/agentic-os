// Copied from the Motion Video deck hero (claude-design-motion-deck/src/beam.js), Jack's own code.
// Lightfall · Lightfall (variant 1) for the Horizon Strike deck hero. Drop-in replacement for the kit's src/beam.js:
// copy this file over <deck>/src/beam.js and run python3 tools/build.py (its beamjs slot inlines this file).
// Mounts on canvas[data-beam]; keeps .beam-ready, data-renderer, the Motion toggle and 'beamstrike'. Original code, no licence strings.
(() => {
/* Lightfall core: the engine every variant shares.
 * One pure function of time: render(t) draws the frame for t (seconds). No state is integrated frame to frame:
 * every particle's position comes from its seed and t, so any t gives the same frame and t = loop equals t = 0.
 * WebGL2 with a WebGL1 fallback. HDR (half float) light buffer -> dual-Kawase bloom -> filmic tone map -> canvas.
 * The canvas is meant to sit on the Horizon Strike hero with mix-blend-mode: screen (black = no light).
 * Planet: circle radius 1.5 x width, apex at 70% height; the impact lands on the apex, dead centre. */
function createLightfall(spec) {
  'use strict';
  const GLSL_HEAD = `
precision highp float;
uniform vec2 uRes;      // canvas size in device px
uniform float uTime;    // seconds inside the loop, [0, uLoop)
uniform float uLoop;    // loop length in seconds
uniform float uPhase;   // uTime / uLoop
uniform float uU;       // device px per design px (design frame = 1080 px tall)
uniform vec3 uPlanet;   // planet centre x, centre y (device px, y down) and radius
uniform vec4 uPtr;      // pointer x, y (device px, y down), active 0..1, radius (device px)
#define PI 3.14159265359
#define TAU 6.28318530718
// Surface coordinates: s = arc length along the planet from the apex (right = +), n = height above the surface.
vec2 toSN(vec2 p) { vec2 d = p - uPlanet.xy; return vec2(atan(d.x, -d.y) * uPlanet.z, length(d) - uPlanet.z); }
vec2 fromSN(vec2 sn) { float th = sn.x / uPlanet.z; return uPlanet.xy + (uPlanet.z + sn.y) * vec2(sin(th), -cos(th)); }
float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
// 1D noise that repeats every 'per' cells: lets a pattern slide by whole periods per loop and stay seamless.
float pnoise1(float x, float per) { float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f);
  return mix(h11(mod(i, per) + 17.0), h11(mod(i + 1.0, per) + 17.0), u); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p * 2.03 + 11.7; a *= 0.5; } return v; }
// Drifting fbm that loops: two copies slide by 'vel' per loop and cross-fade so neither is seen when it jumps.
float loopFbm(vec2 p, vec2 vel) { float a = uPhase, b = fract(uPhase + 0.5);
  float wa = 1.0 - abs(2.0 * a - 1.0), wb = 1.0 - wa;
  float v = fbm(p - vel * a + 13.1) * wa + fbm(p - vel * b + 71.7) * wb;
  return 0.5 + (v - 0.5) / max(0.62, sqrt(wa * wa + wb * wb)); }
float ramp(float a, float b, float x) { return clamp((x - a) / (b - a), 0.0, 1.0); }
// The beam emerges from the dark at the top and reaches full strength by about half height (keeps a headline readable).
// y = design px from the top of the frame. Particles near the axis use beamFade(756 - n).
float beamFade(float y) { float f = smoothstep(-60.0, 560.0, y); return f * sqrt(f); }
`;

  const VS_TRI = `
attribute vec2 aPos; varying vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS_FIELD = (code) => GLSL_HEAD + `
varying vec2 vUV;
${code}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 sn = toSN(px) / uU;
  vec3 c = max(field(px, sn), 0.0) * HDR_IN;
#ifdef LDR
  c += (h21(px + fract(uTime * 7.31) * 97.0) - 0.5) / 255.0;   // 8-bit target: dither before it quantises
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

  // Pointer: a soft obstacle (or attractor) that bends particles near it. Displacement only; never integrated.
  const BEND = `
uniform float uBend;   // > 0 pushes particles around the cursor, < 0 pulls them in
vec2 bendPtr(vec2 p) {
  if (uPtr.z < 0.002) return p;
  vec2 d = p - uPtr.xy; float x = dot(d, d) / (uPtr.w * uPtr.w);
  return p + d * uBend * uPtr.z * exp(-x);
}
vec4 clipPos(vec2 p) { return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }
// The shared physics, in design px (s along the surface, n above it), closed form in the particle's age:
//  1 fall: accelerates down the column from birth height nb (v0, g);
//  2 turn: stagnation-point flow below height hs, n = h e^(-a t), s = s0 e^(a t) (hyperbolic streamlines s*n = const);
//  3 run:  past sj it runs along the planet with linear drag (time constant td), settling to film height nf.
// Speed and direction stay continuous across the joins. spd = speed (design px/s), st = stage 0/1/2.
vec2 flowPath(float s0, float nb, float v0, float g, float hs, float sj, float td, float nf, float age, out float spd, out float st) {
  float sg = s0 < 0.0 ? -1.0 : 1.0, a0 = max(abs(s0), 0.3);
  float drop = nb - hs, t1 = 0.0, V1 = v0;
  if (drop > 0.0) { t1 = (sqrt(v0 * v0 + 2.0 * g * drop) - v0) / g; V1 = v0 + g * t1; }
  if (age < t1) { spd = v0 + g * age; st = 0.0; return vec2(s0, nb - (v0 + 0.5 * g * age) * age); }
  float h0 = min(nb, hs), a = V1 / hs, tt = age - t1;
  float sj2 = max(sj, a0 * 1.01), t2 = log(sj2 / a0) / a;
  if (tt < t2) { float e = exp(a * tt); spd = a * length(vec2(a0 * e, h0 / e)); st = 1.0; return vec2(sg * a0 * e, h0 / e); }
  float t3 = tt - t2, u0 = a * sj2, dec = exp(-t3 / td);
  float nj = h0 * a0 / sj2, tn = max(nj - nf, 0.01) / max(a * nj, 0.01);
  spd = u0 * dec; st = 2.0;
  return vec2(sg * (sj2 + u0 * td * (1.0 - dec)), nf + (nj - nf) * exp(-t3 / tn));
}
`;

  // Dots: each particle is a soft capsule from its position one shutter ago to now (true motion blur).
  const VS_DOTS = (code) => GLSL_HEAD + BEND + `
attribute vec2 aCorner; attribute vec4 aSeed;
uniform float uShutter, uMinR, uGain;
varying vec2 vLocal; varying float vLen, vR; varying vec3 vCol;
${code}
void main() {
  float k = cyclesOf(aSeed), P = uLoop / k;
  float x = uTime / P + aSeed.w, cyc = floor(x), age = (x - cyc) * P, cm = mod(cyc, k);
  if (!alive(aSeed, cm, age)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sn1, sn0; float r1, r0; vec3 c1, c0;
  particle(aSeed, cm, age, sn1, r1, c1);
  particle(aSeed, cm, max(age - uShutter, 0.0), sn0, r0, c0);
  vec2 p1 = bendPtr(fromSN(sn1 * uU)), p0 = bendPtr(fromSN(sn0 * uU));
  vec2 d = p1 - p0; float len = length(d);
  if (len > 120.0 * uU) { p0 = p1; d = vec2(0.0); len = 0.0; }
  vec2 dir = len > 1e-4 ? d / len : vec2(0.0, 1.0), nrm = vec2(-dir.y, dir.x);
  float rp = r1 * uU, rd = max(rp, uMinR);
  float e = (rp * rp) / (rd * rd) * (2.0 * rd) / (2.0 * rd + len);
  float ext = 2.6 * rd;
  vec2 base = aCorner.x < 0.0 ? p0 - dir * ext : p1 + dir * ext;
  vLocal = vec2(aCorner.x < 0.0 ? -ext : len + ext, aCorner.y * ext);
  vLen = len; vR = rd; vCol = c1 * e * uGain;
  gl_Position = clipPos(base + nrm * aCorner.y * ext);
}`;
  const FS_DOTS = `
precision highp float;
varying vec2 vLocal; varying float vLen, vR; varying vec3 vCol;
void main() {
  float a = clamp(vLocal.x, 0.0, vLen);
  vec2 q = vec2(vLocal.x - a, vLocal.y) / vR;
  gl_FragColor = vec4(vCol * exp(-dot(q, q)) * HDR_IN, 1.0);
}`;

  // Trails: a ribbon that follows the particle's real (curved) path over the last uTrail seconds.
  const VS_TRAILS = (code) => GLSL_HEAD + BEND + `
attribute vec2 aCorner; attribute vec4 aSeed;
uniform float uTrail, uK, uMinR, uGain, uTailPow;
varying float vAcross; varying vec3 vCol;
${code}
void main() {
  float k = cyclesOf(aSeed), P = uLoop / k;
  float x = uTime / P + aSeed.w, cyc = floor(x), age = (x - cyc) * P, cm = mod(cyc, k);
  if (!alive(aSeed, cm, age)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = aCorner.x / uK;
  float ag = max(age - uTrail * (1.0 - f), 0.0);
  vec2 sn, snB; float r, rB; vec3 c, cB;
  particle(aSeed, cm, ag, sn, r, c);
  particle(aSeed, cm, ag + 0.004, snB, rB, cB);
  vec2 p = bendPtr(fromSN(sn * uU)), pB = bendPtr(fromSN(snB * uU));
  vec2 tg = pB - p; float tl = length(tg); tg = tl > 1e-5 ? tg / tl : vec2(0.0, 1.0);
  vec2 nr = vec2(-tg.y, tg.x);
  float rp = r * uU, rd = max(rp, uMinR), e = (rp * rp) / (rd * rd);
  float w = rd * mix(0.45, 1.0, f);
  vAcross = aCorner.y * 2.4;
  vCol = c * e * uGain * pow(f, uTailPow);
  gl_Position = clipPos(p + nr * aCorner.y * w * 2.4);
}`;
  const FS_TRAILS = `
precision highp float;
varying float vAcross; varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol * exp(-vAcross * vAcross) * HDR_IN, 1.0); }`;

  // Strands: a ribbon along a whole path at one instant (silk threads). The layer gives the point at f in [0, 1].
  const VS_STRANDS = (code) => GLSL_HEAD + BEND + `
attribute vec2 aCorner; attribute vec4 aSeed;
uniform float uK, uMinR, uGain;
varying float vAcross; varying vec3 vCol;
${code}
void main() {
  if (!strandAlive(aSeed)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = aCorner.x / uK, df = 0.5 / uK;
  vec2 sn, snB; float r, rB; vec3 c, cB;
  strand(aSeed, f, sn, r, c);
  float fB = f + df > 1.0 ? f - df : f + df;
  strand(aSeed, fB, snB, rB, cB);
  vec2 p = bendPtr(fromSN(sn * uU)), pB = bendPtr(fromSN(snB * uU));
  vec2 tg = f + df > 1.0 ? p - pB : pB - p; float tl = length(tg); tg = tl > 1e-5 ? tg / tl : vec2(0.0, 1.0);
  vec2 nr = vec2(-tg.y, tg.x);
  float rp = r * uU, rd = max(rp, uMinR), e = (rp * rp) / (rd * rd);
  vAcross = aCorner.y * 2.4;
  vCol = c * e * uGain;
  gl_Position = clipPos(p + nr * aCorner.y * rd * 2.4);
}`;

  // Segments: capsules whose two ends the layer computes directly (lightning, strands).
  const VS_SEGS = (code, attrs) => GLSL_HEAD + BEND + `
attribute vec2 aCorner; ${attrs.map(a => `attribute vec4 ${a.name};`).join(' ')}
uniform float uMinR, uGain;
varying vec2 vLocal; varying float vLen, vR; varying vec3 vCol;
${code}
void main() {
  vec2 p0, p1; float r; vec3 c;
  if (!segment(p0, p1, r, c)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = p1 - p0; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(0.0, 1.0), nrm = vec2(-dir.y, dir.x);
  float rp = r, rd = max(rp, uMinR), e = (rp * rp) / (rd * rd);
  float ext = 2.6 * rd;
  vec2 base = aCorner.x < 0.0 ? p0 - dir * ext : p1 + dir * ext;
  vLocal = vec2(aCorner.x < 0.0 ? -ext : len + ext, aCorner.y * ext);
  vLen = len; vR = rd; vCol = c * e * uGain;
  gl_Position = clipPos(base + nrm * aCorner.y * ext);
}`;

  const FS_DOWN = `
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uKaris; varying vec2 vUV;
vec3 S; float WS;
void tap(vec2 uv, float k) { vec3 c = texture2D(uSrc, uv).rgb; float w = k / (1.0 + uKaris * dot(c, vec3(0.2126, 0.7152, 0.0722))); S += c * w; WS += w; }
void main() {
  vec2 o = uTexel; S = vec3(0.0); WS = 0.0;
  tap(vUV, 4.0); tap(vUV - o, 1.0); tap(vUV + o, 1.0); tap(vUV + vec2(o.x, -o.y), 1.0); tap(vUV - vec2(o.x, -o.y), 1.0);
  gl_FragColor = vec4(S / WS, 1.0);
}`;
  const FS_UP = `
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uW; varying vec2 vUV;
void main() {
  vec2 o = uTexel;
  vec3 s = texture2D(uSrc, vUV + vec2(-2.0 * o.x, 0.0)).rgb + texture2D(uSrc, vUV + vec2(2.0 * o.x, 0.0)).rgb
         + texture2D(uSrc, vUV + vec2(0.0, 2.0 * o.y)).rgb + texture2D(uSrc, vUV + vec2(0.0, -2.0 * o.y)).rgb
         + 2.0 * (texture2D(uSrc, vUV + o).rgb + texture2D(uSrc, vUV - o).rgb
         + texture2D(uSrc, vUV + vec2(o.x, -o.y)).rgb + texture2D(uSrc, vUV + vec2(-o.x, o.y)).rgb);
  gl_FragColor = vec4(s / 12.0 * uW, 1.0);
}`;
  const FS_COMP = (code) => GLSL_HEAD + `
uniform sampler2D uHDR, uBloom;
uniform float uExposure, uBloomAmt, uBloomBelow, uSat, uGrain, uFrame, uHdrOut;
varying vec2 vUV;
${code || ''}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 hdr = texture2D(uHDR, vUV).rgb * uHdrOut;
  vec3 bl = texture2D(uBloom, vUV).rgb * uHdrOut;
  float n = toSN(px).y / uU;
  float below = mix(uBloomBelow, 1.0, smoothstep(-16.0, 3.0, n));
  vec3 c = hdr + bl * uBloomAmt * below;
#ifdef HAS_GRADE
  c = grade(c, px, n);
#endif
  c = 1.0 - exp(-c * uExposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = pow(c, vec3(1.0 / 2.2));
  float g = h21(px * 0.917 + vec2(uFrame * 37.1, uFrame * 11.3)) + h21(px * 1.31 + vec2(uFrame * 5.7, 91.0)) - 1.0;
  c += g * uGrain * sqrt(l);
  c += (h21(px + vec2(uFrame * 3.1, uFrame * 1.7)) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

  let cv = null, gl = null, gl2 = false, inst = null, disposed = false, opts = {};
  let hdrKind = 'u8', HDR_IN = 0.25;
  let pField, pComp, pDown, pUp, layers = [];
  let bufTri, target = null, bloom = [];
  let W = 0, H = 0;
  const ptr = { x: 0.5, y: 0.5, a: 0, tx: 0.5, ty: 0.5, ta: 0, last: -1 };
  const K = (spec.params || {});

  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function compile(type, src) {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error(src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('Lightfall shader: ' + log);
    }
    return sh;
  }
  function program(vs, fs) {
    const defs = `#define HDR_IN ${HDR_IN.toFixed(4)}\n` + (hdrKind === 'u8' ? '#define LDR\n' : '');
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, defs + vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, defs + fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Lightfall link: ' + gl.getProgramInfoLog(p));
    const u = {}, a = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const inf = gl.getActiveUniform(p, i); u[inf.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, inf.name); }
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const inf = gl.getActiveAttrib(p, i); a[inf.name] = gl.getAttribLocation(p, inf.name); }
    return { p, u, a };
  }

  function detectHDR() {
    const tryKind = (kind) => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        if (kind === 'f16-2') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else if (kind === 'f16-1') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, 0x8D61, null);
      } catch (e) { gl.deleteTexture(tex); return false; }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && !gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      return ok;
    };
    if (gl2 && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) && tryKind('f16-2')) return 'f16-2';
    if (!gl2 && gl.getExtension('OES_texture_half_float') && gl.getExtension('OES_texture_half_float_linear')) {
      gl.getExtension('EXT_color_buffer_half_float');
      if (tryKind('f16-1')) return 'f16-1';
    }
    return 'u8';
  }

  function makeTarget(w, h) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (hdrKind === 'f16-2') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else if (hdrKind === 'f16-1') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, 0x8D61, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); } }

  function drawInstanced(mode, first, count, instances) {
    if (gl2) gl.drawArraysInstanced(mode, first, count, instances); else inst.drawArraysInstancedANGLE(mode, first, count, instances);
  }
  function divisor(loc, d) { if (gl2) gl.vertexAttribDivisor(loc, d); else inst.vertexAttribDivisorANGLE(loc, d); }

  function buildLayer(L, idx) {
    const rand = mulberry((spec.seed || 7) * 1000 + idx * 7919 + 13);
    const mode = L.mode || 'dots';
    let data, count, attrs, stride;
    if (L.instances) { const r = L.instances(rand); data = r.data; count = r.count; attrs = r.attribs; }
    else {
      count = L.count; attrs = [{ name: 'aSeed', size: 4 }]; data = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const s = L.seed ? L.seed(i, rand, count) : [rand(), rand(), rand(), rand()];
        data.set(s, i * 4);
      }
    }
    stride = attrs.reduce((n, a) => n + a.size, 0);
    // Base mesh: a quad (dots, segs) or a (K+1) x 2 strip (trails).
    let mesh, verts;
    if (mode === 'trails' || mode === 'strands') {
      const Kseg = L.segments || 12; const arr = [];
      for (let i = 0; i <= Kseg; i++) arr.push(i, -1, i, 1);
      mesh = new Float32Array(arr); verts = (Kseg + 1) * 2; L._K = Kseg;
    } else { mesh = new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]); verts = 4; }
    const vs = mode === 'trails' ? VS_TRAILS(L.glsl) : mode === 'strands' ? VS_STRANDS(L.glsl) : mode === 'segs' ? VS_SEGS(L.glsl, attrs) : VS_DOTS(L.glsl);
    const fs = mode === 'trails' || mode === 'strands' ? FS_TRAILS : FS_DOTS;
    const prog = program(vs, fs);
    const meshBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    const instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { L, mode, prog, meshBuf, instBuf, verts, count, attrs, stride };
  }

  function setCommon(pr, tt) {
    const u = pr.u, T = spec.loop;
    if (u.uRes) gl.uniform2f(u.uRes, W, H);
    if (u.uTime) gl.uniform1f(u.uTime, tt);
    if (u.uLoop) gl.uniform1f(u.uLoop, T);
    if (u.uPhase) gl.uniform1f(u.uPhase, tt / T);
    if (u.uU) gl.uniform1f(u.uU, H / 1080);
    const R = (opts.radius || 1.5) * W, apexY = (opts.apex || 0.7) * H;
    if (u.uPlanet) gl.uniform3f(u.uPlanet, W / 2, apexY + R, R);
    if (u.uPtr) gl.uniform4f(u.uPtr, ptr.x * W, ptr.y * H, ptr.a, (spec.pointerRadius || 150) * H / 1080);
    if (u.uBend) gl.uniform1f(u.uBend, spec.bend == null ? 1.1 : spec.bend);
    for (const k in K) if (u[k] != null) { const v = K[k]; if (Array.isArray(v)) gl['uniform' + v.length + 'f'](u[k], ...v); else gl.uniform1f(u[k], v); }
  }

  function drawLayer(Y, tt) {
    const pr = Y.prog, u = pr.u, L = Y.L;
    gl.useProgram(pr.p); setCommon(pr, tt);
    if (u.uShutter) gl.uniform1f(u.uShutter, L.shutter == null ? 1 / 90 : L.shutter);
    if (u.uTrail) gl.uniform1f(u.uTrail, L.trail || 0.15);
    if (u.uK) gl.uniform1f(u.uK, Y.L._K || 12);
    if (u.uTailPow) gl.uniform1f(u.uTailPow, L.tailPow == null ? 1.2 : L.tailPow);
    if (u.uMinR) gl.uniform1f(u.uMinR, (L.minR || 0.72) * Math.max(1, H / 1080) * (opts.minRScale || 1));
    if (u.uGain) gl.uniform1f(u.uGain, L.gain == null ? 1 : L.gain);
    const used = [];
    const ac = pr.a.aCorner;
    gl.bindBuffer(gl.ARRAY_BUFFER, Y.meshBuf); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0); divisor(ac, 0); used.push(ac);
    gl.bindBuffer(gl.ARRAY_BUFFER, Y.instBuf);
    let off = 0;
    for (const a of Y.attrs) {
      const loc = pr.a[a.name];
      if (loc != null && loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, Y.stride * 4, off * 4); divisor(loc, 1); used.push(loc); }
      off += a.size;
    }
    drawInstanced(gl.TRIANGLE_STRIP, 0, Y.verts, Y.count);
    for (const loc of used) { divisor(loc, 0); gl.disableVertexAttribArray(loc); }
  }

  function drawTri(pr) {
    const loc = pr.a.aPos;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTri); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disableVertexAttribArray(loc);
  }

  function syncSize() {
    const dprWanted = opts.dpr || Math.min(window.devicePixelRatio || 1, 2);
    let cw = cv.clientWidth || cv.width, ch = cv.clientHeight || cv.height;
    if (opts.width) { cw = opts.width; ch = opts.height; }
    let s = dprWanted; const budget = opts.maxPixels || 8.3e6;
    if (cw * ch * s * s > budget) s = Math.sqrt(budget / (cw * ch));
    const w = Math.max(2, Math.round(cw * s)), h = Math.max(2, Math.round(ch * s));
    if (w === W && h === H && target) return;
    W = w; H = h; cv.width = W; cv.height = H;
    freeTarget(target); bloom.forEach(freeTarget); bloom = [];
    target = makeTarget(W, H);
    let bw = W, bh = H;
    for (let i = 0; i < (spec.bloomLevels || 6); i++) { bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); bloom.push(makeTarget(bw, bh)); }
  }

  function init(canvas, o) {
    cv = canvas; opts = o || {}; disposed = false;
    const attrs = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance' };
    gl = opts.forceWebGL1 ? null : cv.getContext('webgl2', attrs); gl2 = !!gl;
    if (!gl) { gl = cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs); gl2 = false; }
    if (!gl) throw new Error('WebGL unavailable');
    if (!gl2) { inst = gl.getExtension('ANGLE_instanced_arrays'); if (!inst) throw new Error('Instancing unavailable'); }
    hdrKind = opts.forceLDR ? 'u8' : detectHDR(); HDR_IN = hdrKind === 'u8' ? 0.5 : 1.0;
    cv.dataset.renderer = (gl2 ? 'webgl2' : 'webgl') + (hdrKind === 'u8' ? '-ldr' : '');
    bufTri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufTri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    pField = program(VS_TRI, FS_FIELD(spec.field));
    const compDefs = spec.grade ? '#define HAS_GRADE\n' : '';
    pComp = program(VS_TRI, compDefs + FS_COMP(spec.grade));
    pDown = program(VS_TRI, FS_DOWN); pUp = program(VS_TRI, FS_UP);
    layers = (spec.layers || []).map(buildLayer);
    if (spec.onInit) spec.onInit({ gl, gl2 });
    syncSize();
    return variant;
  }

  function render(t) {
    if (!gl || disposed) return;
    syncSize();
    const T = spec.loop; let tt = t % T; if (tt < 0) tt += T;
    // Pointer eases toward its target on the wall clock (interaction only; the loop itself stays pure).
    const now = performance.now(), dt = ptr.last < 0 ? 16 : Math.min(now - ptr.last, 60); ptr.last = now;
    const e = 1 - Math.exp(-dt / (spec.pointerEase || 130));
    if (ptr.a < 0.01 && ptr.ta > 0) { ptr.x = ptr.tx; ptr.y = ptr.ty; }
    ptr.x += (ptr.tx - ptr.x) * e; ptr.y += (ptr.ty - ptr.y) * e; ptr.a += (ptr.ta - ptr.a) * e;
    if (ptr.ta === 0 && ptr.a < 0.002) ptr.a = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(pField.p); setCommon(pField, tt); drawTri(pField);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
    for (const Y of layers) if (!Y.L.skip) drawLayer(Y, tt);

    // Bloom: Karis-weighted first downsample (no fireflies), dual-Kawase chain, additive upsample.
    gl.disable(gl.BLEND);
    gl.useProgram(pDown.p);
    let src = target;
    for (let i = 0; i < bloom.length; i++) {
      const d = bloom[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(pDown.u.uSrc, 0);
      gl.uniform2f(pDown.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform1f(pDown.u.uKaris, i === 0 ? 1.0 : 0.0);
      drawTri(pDown); src = d;
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pUp.p);
    const wts = spec.bloomWeights || [1, 1, 1, 1, 1, 1];
    for (let i = bloom.length - 2; i >= 0; i--) {
      const d = bloom[i], s = bloom[i + 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.uniform1i(pUp.u.uSrc, 0);
      gl.uniform2f(pUp.u.uTexel, 1 / s.w, 1 / s.h); gl.uniform1f(pUp.u.uW, wts[i + 1] == null ? 1 : wts[i + 1]);
      drawTri(pUp);
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(pComp.p); setCommon(pComp, tt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.tex); gl.uniform1i(pComp.u.uHDR, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex); gl.uniform1i(pComp.u.uBloom, 1);
    const C = spec.composite || {};
    gl.uniform1f(pComp.u.uExposure, C.exposure || 1);
    gl.uniform1f(pComp.u.uBloomAmt, (C.bloom == null ? 0.6 : C.bloom) / bloom.length);
    gl.uniform1f(pComp.u.uBloomBelow, C.bloomBelow == null ? 0.45 : C.bloomBelow);
    gl.uniform1f(pComp.u.uSat, C.sat == null ? 1 : C.sat);
    gl.uniform1f(pComp.u.uGrain, C.grain == null ? 0.035 : C.grain);
    gl.uniform1f(pComp.u.uFrame, Math.floor(tt * 60 + 1e-4) % Math.round(T * 60));
    gl.uniform1f(pComp.u.uHdrOut, 1 / HDR_IN);
    drawTri(pComp);
    gl.activeTexture(gl.TEXTURE0);
  }

  // x, y: pointer position relative to the canvas, 0..1 from the top-left. active: true/false or 0..1.
  function setPointer(x, y, active) {
    ptr.tx = Math.max(-0.2, Math.min(1.2, +x || 0)); ptr.ty = Math.max(-0.2, Math.min(1.2, +y || 0));
    ptr.ta = active === true ? 1 : active ? Math.max(0, Math.min(1, +active)) : 0;
  }
  function resize() { if (gl) syncSize(); }
  function dispose() {
    if (!gl) return;
    disposed = true;
    freeTarget(target); bloom.forEach(freeTarget); bloom = []; target = null;
    for (const Y of layers) { gl.deleteBuffer(Y.meshBuf); gl.deleteBuffer(Y.instBuf); gl.deleteProgram(Y.prog.p); }
    [pField, pComp, pDown, pUp].forEach(p => p && gl.deleteProgram(p.p));
    gl.deleteBuffer(bufTri); layers = [];
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose && opts.loseContext) lose.loseContext();
    gl = null; W = H = 0;
  }
  function info() { return { renderer: cv && cv.dataset.renderer, hdr: hdrKind, width: W, height: H, gl: gl }; }

  // Motion Library: move the impact (apex) or flatten the planet without a re-init.
  function configure(o) { Object.assign(opts, o || {}); }
  const variant = { id: spec.id, name: spec.name, loop: spec.loop, strikes: spec.strikes || [], init, render, setPointer, resize, dispose, info, configure };
  return variant;
}

/* Variant 1 · Lightfall: the look closest to the Huly film.
 * A thin white-blue core in a soft halo; thousands of fine dust motes drift down it, lit only where the beam is;
 * faster streamers pour through the hyperbolic turn at the impact; droplets splash; the spill runs out along the
 * planet's curve and fades as drag slows it. Colours are linear light (sRGB targets converted). */
const SPEC_1 = {
  id: 1, name: 'Lightfall', loop: 8, seed: 11,
  bend: 0.55, pointerRadius: 190,
  composite: { exposure: 1.0, bloom: 0.55, bloomBelow: 0.35, sat: 1.08, grain: 0.03 },
  bloomWeights: [1, 1, 0.92, 0.85, 0.8, 0.75],
  strikes: [0.0, 4.0],
  field: `
const vec3 WHITE = vec3(1.0);
const vec3 ICE = vec3(0.448, 0.656, 1.0);
const vec3 BEAM = vec3(0.171, 0.342, 1.0);
const vec3 HALO = vec3(0.073, 0.171, 1.0);
const vec3 DEEP = vec3(0.04, 0.073, 0.828);
vec3 field(vec2 px, vec2 sn) {
  float s = sn.x, n = sn.y, as = abs(s), np = max(n, 0.0);
  float y = px.y / uU;
  float above = smoothstep(-0.9, 0.5, n);
  float topFade = beamFade(y);
  float wide = 1.0 + 1.6 * exp(-np / 130.0);
  float flow = 1.0 + 0.05 * sin(TAU * (np / 190.0 + 6.0 * uPhase)) + 0.035 * sin(TAU * (np / 77.0 + 11.0 * uPhase));
  float core = 4.0 * exp(-s * s / (0.9 * wide * wide)) + 1.1 * exp(-s * s / (16.0 * wide * wide)) * (1.0 + 1.4 * exp(-np / 150.0));
  float inner = 1.5 * exp(-as / (3.2 * wide));
  float body = 1.7 * exp(-as / (7.0 * wide));
  float glow = 0.42 * exp(-as / (22.0 * wide));
  float outer = 0.07 * exp(-as / (75.0 * wide));
  float lift = 0.8 + 0.45 * exp(-np / 240.0);
  vec3 col = (core * WHITE + inner * ICE + (body + glow) * HALO + outer * DEEP) * topFade * above * flow * lift;
  // The flare: light follows the hyperbolic streamlines s*n = const into the surface.
  float bell = exp(-as * np / 1900.0) * exp(-as / 280.0) * exp(-np / 75.0) * above;
  col += bell * (0.75 * ICE + 1.15 * HALO);
  // Stagnation point: the white-hot pile-up where the column meets the surface.
  col += 2.2 * exp(-s * s / (24.0 * 24.0) - np * np / (5.5 * 5.5)) * above * WHITE;
  // The spill: a thin film of light on the rim, sliding outward (64 cells per loop = seamless).
  float slide = pnoise1(as / 24.0 - 64.0 * uPhase, 64.0), slide2 = pnoise1(as / 9.0 - 128.0 * uPhase, 128.0);
  float reach = 1.45 * exp(-as / 420.0) + 1.0 * exp(-as / 75.0);
  float knots = pow(slide, 3.0);
  float film = exp(-n * n / (1.25 * 1.25)) * reach * (0.45 + 0.9 * knots + 0.15 * slide2);
  col += film * mix(ICE, WHITE, exp(-as / 80.0));
  col += 0.3 * exp(-np / 10.0) * above * reach * (0.6 + 0.4 * slide) * HALO;
  // Light scattered onto the planet just under the rim.
  col += 0.22 * exp(min(n, 0.0) / 3.5) * (1.0 - above) * exp(-as / 170.0) * BEAM;
  // Volumetric mist around the column, lit by the beam, drifting up and aside.
  float fogA = loopFbm(vec2(s / 230.0 + 3.0, y / 170.0), vec2(0.45, 0.30));
  float fogB = loopFbm(vec2(s / 90.0 - 7.0, y / 70.0), vec2(-0.6, 0.5));
  float fogD = smoothstep(0.46, 0.86, fogA * 0.75 + fogB * 0.35);
  float fogLit = (0.3 * exp(-as / 150.0) + 1.6 * exp(-as / 38.0)) * smoothstep(-60.0, 260.0, y) * smoothstep(0.0, 160.0, np) * above;
  col += fogD * fogLit * 0.5 * mix(HALO, DEEP, 0.35);
  // Cursor: a soft cool glow that also reveals the mist.
  vec2 dp = (px - uPtr.xy) / uU; float pr = uPtr.w / uU;
  // deck tweak (Jack: the cursor glow must be much subtler, smaller and softer so the beam stands out):
  // glow radius x0.63 and strength x0.1; the particles still bend around the cursor at full radius
  float pg = exp(-dot(dp, dp) / (pr * pr * 0.8 * 0.4)) * uPtr.z * 0.1;
  col += pg * (0.035 * ICE + 0.07 * HALO) + pg * fogD * 0.25 * BEAM;
  return col;
}`,
  layers: [
    { // Fine dust: the thousands of motes that drift down the light and sparkle where it hits them.
      mode: 'dots', count: 16000, shutter: 1 / 120, minR: 0.6, gain: 1.0,
      glsl: `
float cyclesOf(vec4 s) { return 1.0 + floor(s.z * 3.0); }
bool alive(vec4 s, float cm, float age) { return true; }
void particle(vec4 s, float cm, float age, out vec2 sn, out float r, out vec3 col) {
  float qa = h11(s.x * 91.7 + cm * 3.1), qb = h11(s.y * 57.3 + cm * 7.7), qc = h11(s.x * 13.1 + s.y * 3.7 + cm * 1.3);
  float sg = qa < 0.5 ? -1.0 : 1.0;
  float a0 = 0.5 + 46.0 * pow(qb, 2.6);
  float nb = mix(-4.0, 820.0, qc);
  float v0 = 12.0 + 22.0 * h11(s.y * 7.1), g = 16.0 + 30.0 * h11(s.x * 5.3);
  float hs = 62.0 + 36.0 * h11(s.w * 3.3);
  float spd, st;
  vec2 p = flowPath(sg * a0, nb, v0, g, hs, 150.0 + 2.5 * a0, 1.1, 0.8, age, spd, st);
  p.x += 1.1 * sin(TAU * (age * 0.3 + s.y)) * ramp(8.0, 60.0, p.y);
  float life = uLoop / cyclesOf(s);
  float env = ramp(0.0, 0.4, age) * ramp(life, life - 0.9, age);
  float as = abs(p.x), np = max(p.y, 0.0);
  float lit = exp(-as / 7.0) + 0.38 * exp(-as / 30.0) + 1.1 * exp(-as * np / 1600.0) * exp(-as / 240.0) * exp(-np / 70.0);
  float tw = 0.5 + 0.5 * sin(TAU * (floor(3.0 + 9.0 * s.x) * uPhase + s.w * 7.0));
  tw *= tw;
  float run = st > 1.5 ? smoothstep(0.0, 50.0, spd) : 1.0;
  float topFade = beamFade(756.0 - p.y);
  float big = pow(h11(s.z * 71.0), 4.0);
  r = mix(0.38, 0.95, big);
  float I = (1.8 + 2.0 * big) * lit * (0.25 + 0.75 * tw) * env * run * topFade;
  col = mix(vec3(0.16, 0.36, 1.0), vec3(0.72, 0.86, 1.0), pow(h11(s.y * 33.0), 2.0)) * I;
  sn = p;
}` },
    { // Streamers: faster sparks, faint up the column, that draw the flowing strands through the turn and out along the rim.
      mode: 'trails', count: 2600, segments: 16, trail: 0.2, minR: 0.6, gain: 1.0, tailPow: 1.3,
      glsl: `
float cyclesOf(vec4 s) { return 2.0 + floor(s.z * 3.0); }
bool alive(vec4 s, float cm, float age) { return true; }
void particle(vec4 s, float cm, float age, out vec2 sn, out float r, out vec3 col) {
  float qa = h11(s.x * 31.7 + cm * 5.1), qb = h11(s.y * 17.3 + cm * 2.7), qc = h11(s.x * 3.1 + s.y * 9.7 + cm * 4.3);
  float sg = qa < 0.5 ? -1.0 : 1.0;
  float a0 = 0.35 + 48.0 * pow(qb, 1.9);
  float nb = mix(20.0, 520.0, qc);
  float v0 = 60.0 + 70.0 * h11(s.y * 3.9), g = 150.0 + 140.0 * h11(s.x * 8.1);
  float hs = 50.0 + 50.0 * h11(s.w * 5.9);
  float spd, st;
  vec2 p = flowPath(sg * a0, nb, v0, g, hs, 120.0 + 2.2 * a0, 0.6, 0.6, age, spd, st);
  float life = uLoop / cyclesOf(s);
  float env = ramp(0.0, 0.3, age) * ramp(life, life - 0.6, age);
  float as = abs(p.x), np = max(p.y, 0.0);
  float low = mix(0.12, 1.0, exp(-np / 90.0));
  float lit = exp(-as / 12.0) + 0.5 * exp(-as / 60.0) + 1.3 * exp(-as * np / 1800.0) * exp(-as / 280.0) * exp(-np / 60.0);
  float run = st > 1.5 ? smoothstep(0.0, 80.0, spd) : 1.0;
  r = 0.42 + 0.2 * h11(s.z * 13.0);
  col = mix(vec3(0.35, 0.58, 1.0), vec3(0.9, 0.95, 1.0), 0.3 + 0.5 * h11(s.w * 21.0)) * (1.3 * lit * env * run * low);
  sn = p;
}` },
    { // Splash: droplets thrown up from the impact on ballistic arcs; they land and skid along the curve.
      mode: 'trails', count: 600, segments: 10, trail: 0.1, minR: 0.6, gain: 1.0, tailPow: 1.2,
      glsl: `
float cyclesOf(vec4 s) { return 4.0 + floor(s.z * 5.0); }
bool alive(vec4 s, float cm, float age) { return true; }
void particle(vec4 s, float cm, float age, out vec2 sn, out float r, out vec3 col) {
  float qa = h11(s.x * 11.7 + cm * 5.3), qb = h11(s.y * 27.3 + cm * 3.9), qc = h11(s.w * 7.3 + cm * 8.1);
  float sg = qa < 0.5 ? -1.0 : 1.0;
  float vs = sg * (40.0 + 300.0 * pow(qb, 1.6));
  float vn = 25.0 + 170.0 * pow(qc, 2.4);
  float gs = 1300.0, tl = 2.0 * vn / gs, s0 = sg * (1.0 + 12.0 * h11(s.x * 3.3 + cm));
  vec2 p; float spd;
  if (age < tl) { p = vec2(s0 + vs * age, vn * age - 0.5 * gs * age * age); spd = length(vec2(vs, vn - gs * age)); }
  else { float t3 = age - tl, dec = exp(-t3 / 0.32); p = vec2(s0 + vs * tl + vs * 0.32 * (1.0 - dec), 0.6); spd = abs(vs) * dec; }
  float life = uLoop / cyclesOf(s);
  float env = ramp(0.0, 0.04, age) * ramp(life, life * 0.55, age) * smoothstep(0.0, 40.0, spd);
  r = 0.42 + 0.25 * h11(s.y * 5.0);
  col = vec3(0.6, 0.78, 1.0) * (2.0 * env * exp(-abs(p.x) / 320.0));
  sn = p;
}` },
  ],
};

/* Deck adapter: mounts a Lightfall variant on the Horizon Strike hero (canvas[data-beam] inside section.hero).
 * Same contract as the kit's beam.js, so it can replace it one for one:
 *  - adds .beam-ready to the section and sets canvas.dataset.renderer (check.py R1 reads both);
 *  - pauses when the tab is hidden or the hero is off screen; honours the deck's Motion toggle (body.motion-off)
 *    and prefers-reduced-motion (the frame holds still);
 *  - passes the pointer through (soft glow + particles bend around it);
 *  - fires the section's 'beamstrike' event and sets --flash at the variant's strike times, so the horizon glints
 *    run along the curve in sync with the light. */
function mountLightfallHero(V) {
  const canvas = document.querySelector('canvas[data-beam]');
  if (!canvas) return null;
  const host = canvas.closest('section') || canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionOn = () => !reduced.matches && !document.body.classList.contains('motion-off');
  try { V.init(canvas); } catch (err) { console.warn('Lightfall fallback:', err.message); canvas.dataset.renderer = 'fallback'; return null; }
  host.classList.add('beam-ready');
  const strikes = (V.strikes || []).slice().sort((a, b) => a - b);
  let t = 0, prev = performance.now(), inView = true, raf = 0, flash = 0;
  function tick(now) {
    const dt = Math.min(now - prev, 50) / 1000; prev = now;
    if (inView && !document.hidden) {
      if (motionOn()) {
        const a = t % V.loop; t += dt; const b = t % V.loop;
        for (const s of strikes) if (b >= a ? (s > a && s <= b) : (s > a || s <= b)) { flash = 0.7; host.dispatchEvent(new CustomEvent('beamstrike')); }
        flash *= Math.pow(0.86, dt * 60);
        host.style.setProperty('--flash', flash.toFixed(3));
      }
      V.render(t);
    }
    raf = requestAnimationFrame(tick);
  }
  host.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); V.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, 1); });
  host.addEventListener('pointerleave', () => V.setPointer(0.5, 0.5, 0));
  new IntersectionObserver(es => { inView = es[0].isIntersecting; }, { threshold: 0 }).observe(host);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(raf); host.classList.remove('beam-ready'); });
  canvas.addEventListener('webglcontextrestored', () => { try { V.init(canvas); host.classList.add('beam-ready'); prev = performance.now(); raf = requestAnimationFrame(tick); } catch (err) { console.warn(err); } });
  raf = requestAnimationFrame(tick);
  return V;
}

// Motion Library mounts this itself (slower clock, subtle, paused off screen).
window.MotionHeroLightfall = { create: () => createLightfall(SPEC_1), loop: SPEC_1.loop };
})();
