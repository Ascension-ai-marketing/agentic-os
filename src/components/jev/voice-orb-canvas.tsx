// A living glass sphere drawn with one WebGL fragment shader. Its colours
// follow the voice state, and its rim swells with the live audio level.
import { useEffect, useRef, type MutableRefObject } from "react";
import type { PointerState } from "./star-field";

export type OrbMood = "idle" | "listening" | "thinking" | "working" | "speaking" | "error";

type Palette = { c: [number, number, number][]; speed: number; swirl: number };

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

export const ORB_PALETTES: Record<OrbMood, Palette> = {
  // Idle is replaced every frame by the colour cycle below.
  idle: { c: [hex("#2a0d2a"), hex("#d45bb6"), hex("#f386a1")], speed: 0.3, swirl: 0.7 },
  listening: { c: [hex("#04403c"), hex("#2ee6c8"), hex("#f2fffc")], speed: 0.8, swirl: 1.1 },
  // Jev's own colours (TypeSafe magenta and pink) while it decides.
  thinking: { c: [hex("#3a0b33"), hex("#d45bb6"), hex("#f386a1")], speed: 1.8, swirl: 2.3 },
  working: { c: [hex("#4a1c04"), hex("#f5a524"), hex("#fff1c7")], speed: 1.1, swirl: 1.6 },
  speaking: { c: [hex("#1f1a6e"), hex("#8f7cff"), hex("#f1efff")], speed: 0.9, swirl: 1.2 },
  // Errors are a soft amber-rose, never an alarm red.
  error: { c: [hex("#3a1614"), hex("#f2957a"), hex("#ffe6d6")], speed: 0.35, swirl: 0.5 },
};

// The resting orb drifts through every mood colour, one after another.
export const CYCLE: [number, number, number][][] = [
  [hex("#2a0d2a"), hex("#d45bb6"), hex("#f386a1")],
  [hex("#1f1a6e"), hex("#8f7cff"), hex("#eae6ff")],
  [hex("#0b2350"), hex("#5b93ff"), hex("#e3ecff")],
  [hex("#04403c"), hex("#2ee6c8"), hex("#effffb")],
  [hex("#4a1c04"), hex("#f5a524"), hex("#fff1c7")],
];
export const CYCLE_SECONDS = 4.5;
export function cycleAt(t: number): number[][] {
  // A clock reset can hand in a negative or NaN time; wrap it into the cycle.
  const raw = (t / CYCLE_SECONDS) % CYCLE.length;
  const pos = Number.isFinite(raw) ? (raw + CYCLE.length) % CYCLE.length : 0;
  const i = Math.floor(pos);
  const f = pos - i;
  const e = f * f * (3 - 2 * f);
  const a = CYCLE[i], b = CYCLE[(i + 1) % CYCLE.length];
  return a.map((c, k) => c.map((v, j) => v + (b[k][j] - v) * e));
}

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}`;

const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime;uniform float uLevel;uniform float uSwirl;uniform float uFlash;uniform vec2 uPoint;uniform float uHover;
uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;
float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=0.5;}return v;}
void main(){
vec2 uv=(gl_FragCoord.xy-0.5*uRes)/min(uRes.x,uRes.y)*2.0;
float r=length(uv);float ang=atan(uv.y,uv.x);float t=uTime;
float wob=(noise(vec3(cos(ang)*1.6,sin(ang)*1.6,t*0.9))-0.5)*(0.05+0.26*uLevel);
wob+=max(0.0,dot(normalize(uv+1e-4),uPoint))*0.06*uHover;
float R=0.66+0.05*uLevel+wob;
float inside=1.0-smoothstep(R-0.014,R+0.014,r);
float rr=clamp(r/R,0.0,1.0);float z=sqrt(max(0.0,1.0-rr*rr));
vec3 n=vec3(uv/R,z);
vec3 q=n*1.55+vec3(0.0,0.0,t*0.3);
float n1=fbm(q+vec3(t*0.22*uSwirl,-t*0.1,0.0));
float n2=fbm(q*1.35+vec3(n1*2.4,t*0.2,1.3));
float m=clamp(n2*1.3-0.12+0.3*uLevel*(1.0-rr),0.0,1.0);
vec3 col=mix(uC1,uC2,smoothstep(0.18,0.7,m));
col=mix(col,uC3,smoothstep(0.64,0.96,m)*0.85);
vec3 L=normalize(vec3(mix(-0.45,uPoint.x*1.1,uHover),mix(0.6,uPoint.y*1.1,uHover),0.8));
float diff=clamp(dot(normalize(n),L),0.0,1.0);
col*=0.5+0.65*diff;
float fres=pow(1.0-z,2.4);
col+=uC2*fres*0.95+uC3*fres*0.25;
float spec=pow(clamp(dot(reflect(-L,normalize(n)),vec3(0.0,0.0,1.0)),0.0,1.0),28.0);
col+=vec3(1.0)*spec*0.5;
col+=uC3*uFlash*(0.35+fres*1.4);
float glow=exp(-max(r-R,0.0)*(6.5-2.5*uFlash))*(0.32+0.55*uLevel+0.6*uFlash+0.18*uHover);
glow*=1.0-smoothstep(0.8,0.97,r);
float a=inside+(1.0-inside)*glow*0.85;
vec3 outc=mix(uC2*glow,col,inside);
gl_FragColor=vec4(outc*a,a);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

export function VoiceOrbCanvas({
  mood,
  levelRef,
  pointerRef,
  size,
  className,
}: {
  mood: OrbMood;
  levelRef?: MutableRefObject<number>;
  // Pointer in orb space (-1..1, y up) so the light follows the cursor.
  pointerRef?: MutableRefObject<PointerState>;
  size: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLSpanElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) {
      canvas.hidden = true;
      if (fallbackRef.current) fallbackRef.current.hidden = false;
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
    } catch {
      canvas.hidden = true;
      if (fallbackRef.current) fallbackRef.current.hidden = false;
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes"), uTime = u("uTime"), uLevel = u("uLevel"), uSwirl = u("uSwirl"), uFlash = u("uFlash"), uPoint = u("uPoint"), uHover = u("uHover");
    const uC = [u("uC1"), u("uC2"), u("uC3")];

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const start = ORB_PALETTES[moodRef.current];
    const cur = { c: start.c.map((c) => [...c]) as number[][], speed: start.speed, swirl: start.swirl };
    let phase = Math.random() * 100;
    let level = 0;
    let flash = 0;
    let hover = 0, px = 0, py = 0;
    let lastMood = moodRef.current;
    // A shared wall clock, so every orb on screen shows the same colour.
    let clock = (Date.now() / 1000) % (CYCLE_SECONDS * CYCLE.length);
    let last = performance.now();
    let raf = 0;

    const frame = (now: number, force = false) => {
      raf = requestAnimationFrame((t) => frame(t));
      if (document.hidden && !force) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const mood = moodRef.current;
      if (mood !== lastMood) {
        lastMood = mood;
        flash = 1;
      }
      flash = Math.max(0, flash - dt * 1.6);
      clock += dt * (reduce ? 0.3 : 1);
      const target = ORB_PALETTES[mood];
      const colours = mood === "idle" ? cycleAt(clock) : target.c;
      // A slower blend reads as a morph rather than a cut.
      const k = 1 - Math.exp(-dt * 3.2);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur.c[i][j] += (colours[i][j] - cur.c[i][j]) * k;
      cur.speed += (target.speed - cur.speed) * k;
      cur.swirl += (target.swirl - cur.swirl) * k;
      const want = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      level += (want - level) * (want > level ? 0.35 : 0.08);
      phase += dt * cur.speed * (reduce ? 0.25 : 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, phase);
      gl.uniform1f(uLevel, reduce ? level * 0.4 : level);
      gl.uniform1f(uSwirl, cur.swirl);
      gl.uniform1f(uFlash, reduce ? 0 : flash);
      const pt = pointerRef?.current;
      const kh = 1 - Math.exp(-dt * 7);
      hover += ((pt?.active ?? 0) - hover) * kh;
      px += ((pt?.x ?? 0) - px) * kh;
      py += ((pt?.y ?? 0) - py) * kh;
      gl.uniform2f(uPoint, px, -py);
      gl.uniform1f(uHover, reduce ? hover * 0.4 : hover);
      uC.forEach((l, i) => gl.uniform3f(l, cur.c[i][0], cur.c[i][1], cur.c[i][2]));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    // Paint once straight away so the orb is visible even before the first
    // animation frame (background tabs, screenshots).
    frame(performance.now(), true);
    return () => {
      cancelAnimationFrame(raf);
      // Do not lose the context here: React's dev double-mount reuses the
      // same canvas, and a lost context cannot compile shaders again.
    };
  }, [size, levelRef, pointerRef]);

  return (
    <span className={`jev-orb ${className ?? ""}`} data-mood={mood} style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <span ref={fallbackRef} className="jev-orb-fallback" hidden />
    </span>
  );
}
