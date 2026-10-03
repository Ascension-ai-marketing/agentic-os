// Six candidate backdrops for the voice orb, each one fragment shader. All
// share the orb's state colours, react to the voice level and lean toward
// the pointer. Coordinates are in orb radii: the orb's edge sits at r = 1.
import { useEffect, useRef, type MutableRefObject } from "react";
import { ORB_PALETTES, cycleAt, CYCLE, CYCLE_SECONDS, type OrbMood } from "./voice-orb-canvas";
import type { PointerState } from "./star-field";

export type BackdropId = "lightning" | "aurora" | "horizon" | "nebula" | "galaxy" | "liquid";

export const BACKDROPS: { id: BackdropId; name: string; note: string }[] = [
  { id: "lightning", name: "Ion storm", note: "The orb rises over a planet’s glowing edge. Fine lightning crackles round it, more when you talk." },
  { id: "aurora", name: "Aurora silk", note: "Northern-lights curtains that bend around the orb." },
  { id: "horizon", name: "Event horizon", note: "A black-hole light ring. Space warps around the orb." },
  { id: "nebula", name: "Deep nebula", note: "Rich gas clouds and dust lanes drifting behind it." },
  { id: "galaxy", name: "Spiral galaxy", note: "Glowing spiral arms turning around the orb." },
  { id: "liquid", name: "Liquid iridescence", note: "Oil-slick colour that ripples with your voice." },
];

const HEAD = `precision highp float;
uniform vec2 uRes;uniform vec2 uCenter;uniform float uOrbR;uniform float uTime;uniform float uLevel;uniform float uFlash;
uniform float uHover;uniform float uEnergy;uniform vec2 uPoint;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform float uDrift;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
vec2 cuv(){return (gl_FragCoord.xy-uCenter)/uOrbR;}
float stars(vec2 p,float d){vec2 g=floor(p*d);vec2 f=fract(p*d)-.5;float h=hash(g);vec2 o=(vec2(hash(g+1.3),hash(g+7.1))-.5)*.6;
float s=step(.965,h)*(1.-smoothstep(0.,.09,length(f-o)));return s*(.55+.45*sin(uTime*(1.+h*3.)+h*40.));}
vec3 tone(vec3 c){return 1.-exp(-c*1.4);}
`;

const FRAG: Record<BackdropId, string> = {
  lightning: `void main(){
vec2 p=cuv();float r=length(p);
vec3 col=mix(vec3(.004,.007,.018),vec3(.018,.04,.09),smoothstep(-3.,2.5,p.y));
float smoke=fbm(p*.32+vec2(uTime*.02,-uTime*.012));
col+=vec3(.045,.08,.15)*pow(smoke,2.2)*1.3;
float PR=11.;vec2 pc=vec2(0.,-2.15-PR);float dp=length(p-pc)-PR;
col=mix(col,vec3(.003,.005,.011),1.-smoothstep(-.03,.03,dp));
col+=vec3(1.,.56,.32)*exp(-abs(dp)*uOrbR*.35)*.95;
col+=mix(vec3(.3,.55,1.),uC2,.25)*exp(-max(dp,0.)*1.6)*.5*step(0.,dp);
col+=mix(vec3(.45,.65,1.),uC2,.4)*.28*exp(-r*.75);
float t=uTime;float rate=.8+uEnergy*3.+uLevel*4.+uFlash*4.;
vec3 boltC=mix(vec3(.78,.88,1.),uC3,.25);
for(int i=0;i<8;i++){float fi=float(i);
float slot=floor(t*rate+fi*1.61);float seed=hash(vec2(fi,slot));
float on=step(.78-uEnergy*.5-uLevel*.3-uFlash*.4,seed);
float ang=seed*6.2831+fi*.8;if(uHover>.02&&dot(uPoint,uPoint)>1e-4)ang=mix(ang,atan(uPoint.y,uPoint.x)+(seed-.5)*1.3,uHover*.7);
vec2 dir=vec2(cos(ang),sin(ang));vec2 nrm=vec2(-dir.y,dir.x);
float al=dot(p,dir);float ac=dot(p,nrm);
float len=1.9+seed*1.6+uLevel*.9+uEnergy*.5;
float jag=(fbm(vec2(al*3.2,seed*50.+slot))-.5)*.5*(al-.9);
float fade=smoothstep(.98,1.08,al)*(1.-smoothstep(len*.7,len,al));
float life=fract(t*rate+fi*1.61);float fl=exp(-life*2.6)*(.72+.28*sin(t*120.+fi*3.));
float d=abs(ac-jag)*uOrbR;
float b=(exp(-d*.9)*1.3+.3*exp(-d*.15))*fade*fl*on;
float j2=jag+(fbm(vec2(al*5.,seed*90.))-.5)*.6*max(0.,al-1.25)+(seed-.5)*.9*max(0.,al-1.25);
float d2=abs(ac-j2)*uOrbR;
b+=(exp(-d2*1.4)*.8+.12*exp(-d2*.2))*fade*fl*on*step(1.25,al);
col+=b*boltC;}
col+=stars(p*.3,20.)*.45*smoothstep(-.5,1.,p.y);
col+=vec3(.5,.7,1.)*uFlash*.25*exp(-r*.6);
gl_FragColor=vec4(tone(col),1.);}`,

  aurora: `void main(){
vec2 p=cuv()/2.6;float r=length(p);
p+=normalize(p+1e-4)*.09/(r+.3)*(1.+uLevel);p+=uPoint*.06*uHover;
vec3 col=vec3(.004,.01,.022)+stars(p,34.)*.55;
for(int k=0;k<4;k++){float fk=float(k);
float x=p.x*1.3+fk*.7;
float y0=.42-fk*.2+sin(x*1.4+uTime*.28+fk)*.16+(fbm(vec2(x*1.6,uTime*.1+fk))-.5)*.34;
float dy=p.y-y0;
float cur=exp(-max(dy,0.)*5.)*smoothstep(-.015,0.,dy)+exp(-abs(dy)*45.)*.5;
float rays=.5+.5*fbm(vec2(x*14.,uTime*.45+fk*3.));
vec3 c=k==0?uC2:k==1?uC3*.9:k==2?mix(uC2,uC1,.5)+.15:uC1+.25;
col+=c*cur*rays*(.6+uLevel*.7+uFlash*.5);}
gl_FragColor=vec4(tone(col),1.);}`,

  horizon: `void main(){
vec2 p=cuv();float r=length(p);
vec2 lp=p*(1.-.9/(r*r+1.1));
vec3 col=stars(lp*.28+vec2(uTime*.004,0.),26.)*vec3(.95)+uC1*.07;
float tilt=.3+uPoint.y*.1*uHover;vec2 q=vec2(p.x,p.y/tilt);
float rq=length(q),aq=atan(q.y,q.x);
float band=smoothstep(1.12,1.3,rq)*(1.-smoothstep(1.6,3.4,rq));
float sw=fbm(vec2(aq*3.-uTime*(.7+uLevel*2.2)*2./rq,rq*2.5));
float dop=.5+.5*cos(aq-.4);
vec3 disk=mix(uC2,uC3,sw)*band*(.4+1.3*sw)*(.35+dop);
float front=step(p.y,0.);float hide=1.-(1.-front)*(1.-smoothstep(.98,1.06,r));
col+=disk*hide*(.9+uLevel*.8);
float ring=exp(-pow((r-1.06)/.035,2.))*(.6+.4*fbm(vec2(atan(p.y,p.x)*4.-uTime,1.)));
col+=mix(uC3,vec3(1.),.5)*ring*(.8+uFlash*1.5);
float arc=exp(-pow((length(vec2(p.x,(p.y-.1)/.92))-1.28)/.09,2.))*step(0.,p.y)*.6;
col+=mix(uC2,uC3,.5)*arc*(.5+sw);
gl_FragColor=vec4(tone(col),1.);}`,

  nebula: `void main(){
vec2 p=cuv();float r=length(p);vec2 P=p/2.6;
P+=normalize(P+1e-4)*.07/(length(P)+.3)*(.5+uLevel)+uPoint*.05*uHover;
float lw=uDrift*(1.-smoothstep(0.,.6,gl_FragCoord.x/uRes.x));
P+=lw*(vec2(fbm(P*1.4+vec2(uTime*.06,0.)),fbm(P*1.4+vec2(3.1,-uTime*.05)))-.5)*.4;
float t=uTime*.05;
vec2 q=vec2(fbm(P*1.3+t),fbm(P*1.3+vec2(5.2,1.3)-t));
vec2 w=vec2(fbm(P*1.7+q*2.2+vec2(1.7,9.2)+t*1.4),fbm(P*1.7+q*2.2+vec2(8.3,2.8)));
float n=fbm(P*2.+w*2.4);
vec3 deep=vec3(.09,.03,.22),mag=vec3(.83,.36,.71),teal=vec3(.1,.62,.66),gold=vec3(1.,.78,.55);
vec3 base=mix(deep,uC1*1.2,.35);
vec3 col=vec3(.004,.003,.012);
col=mix(col,base,smoothstep(.22,.62,n));
col=mix(col,mix(mag,uC2,.4),smoothstep(.45,.9,n*w.x*1.7)*.85);
col=mix(col,mix(teal,uC3,.3),smoothstep(.5,.95,n*w.y*1.8)*.55);
col+=gold*pow(smoothstep(.72,1.02,n*n*1.7),2.)*.55;
float dust=smoothstep(.5,.76,fbm(P*3.2-w+t));col*=1.-dust*.72;
float cluster=fbm(P*1.1-t*.5);
col+=stars(P,55.)*(.5+cluster)+stars(P+3.,120.)*.45+stars(P+7.,220.)*.25*cluster;
col+=mix(mag,uC2,.5)*.28*exp(-r*.55)*(1.+uLevel);
col+=uC2*uFlash*.35*exp(-r*.5);
gl_FragColor=vec4(tone(col*1.15),1.);}`,

  galaxy: `void main(){
vec2 p=cuv();vec2 P=p/3.;P.y/=.72;P+=uPoint*.05*uHover;
float r=length(P),a=atan(P.y,P.x);
float spin=uTime*(.1+uLevel*.45+uFlash*.3);
float arms=pow(.5+.5*cos(2.*(a-log(r+.001)*3.2+spin)),3.);
float dust=fbm(vec2(a*3.-log(r+.001)*6.+spin*2.,r*8.));
float fall=exp(-r*1.9);
vec3 col=vec3(.005,.004,.016);
col+=mix(uC1*1.3,uC2,arms)*arms*fall*2.4*(.55+dust);
col+=uC3*pow(arms*dust,3.)*fall*3.2;
col+=stars(P*1.3+vec2(spin*.1,0.),70.)*arms*2.+stars(P,40.)*.5;
col+=uC3*exp(-r*8.)*.9;
gl_FragColor=vec4(tone(col),1.);}`,

  liquid: `void main(){
vec2 p=cuv();float r=length(p);vec2 P=p/2.6+uPoint*.08*uHover;
float t=uTime*.14;
vec2 o=vec2(t,-t*.7);
float h=fbm(P*2.+o+fbm(P*3.-t)*1.5);
h+=.09*uLevel*sin(r*2.2-uTime*6.)+.16*uFlash*sin(r*1.6-uTime*10.);
vec3 film=.5+.5*cos(6.2831*(h*1.3+vec3(0.,.33,.67)));
film=mix(vec3(dot(film,vec3(.33))),film,.55);
film=mix(film,mix(uC2,uC3,.5),.35);
float ridge=pow(smoothstep(.35,.75,h),2.);
vec3 col=vec3(.012,.012,.02)+film*ridge*.95+film*.05;
float hx=fbm(P*2.+vec2(.01,0.)+o+fbm(P*3.-t)*1.5)-fbm(P*2.+o+fbm(P*3.-t)*1.5);
col+=pow(max(0.,hx*45.),3.)*.45*mix(vec3(1.),uC3,.3);
col=mix(vec3(.01,.008,.02),col,smoothstep(.9,1.5,r));
gl_FragColor=vec4(col,1.);}`,
};

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

export function OrbBackdrop({
  variant,
  mood,
  levelRef,
  pointerRef,
  centerY = 0.4,
  centerX = 0.5,
  orbSize,
  drift = 0,
}: {
  variant: BackdropId;
  mood: OrbMood;
  levelRef: MutableRefObject<number>;
  pointerRef: MutableRefObject<PointerState>;
  centerY?: number;
  centerX?: number;
  orbSize: number;
  /** Extra, bounded swirl on the left third (the Live hero uses it). */
  drift?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const gl = c.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, HEAD + FRAG[variant]));
      gl.linkProgram(prog);
    } catch (e) {
      console.warn("[orb backdrop]", variant, e);
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
    const ENERGY: Record<OrbMood, number> = { idle: 0.15, listening: 0.5, thinking: 1, speaking: 0.55, working: 0.75, error: 0.1 };
    let energy = 0.15;
    const U = { energy: u("uEnergy"), res: u("uRes"), center: u("uCenter"), orbR: u("uOrbR"), time: u("uTime"), level: u("uLevel"), flash: u("uFlash"), hover: u("uHover"), point: u("uPoint"), drift: u("uDrift"), c: [u("uC1"), u("uC2"), u("uC3")] };
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0;
    const size = () => {
      const r = c.getBoundingClientRect();
      w = r.width;
      h = r.height;
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, c.width, c.height);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const cur = ORB_PALETTES.idle.c.map((x) => [...x]);
    let lastMood = moodRef.current, flash = 0, level = 0, hover = 0, px = 0, py = 0, clock = ((Date.now() / 1000) % (CYCLE_SECONDS * CYCLE.length)) / 0.6, time = Math.random() * 50;
    let last = performance.now(), raf = 0;
    const frame = (now: number, force = false) => {
      raf = requestAnimationFrame((t) => frame(t));
      if (document.hidden && !force) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = moodRef.current;
      if (m !== lastMood) {
        lastMood = m;
        flash = 1;
      }
      flash = Math.max(0, flash - dt * 1.4);
      clock += dt;
      time += dt * (reduce ? 0.2 : 1);
      const target = m === "idle" ? cycleAt(clock * 0.6) : ORB_PALETTES[m].c;
      const k = 1 - Math.exp(-dt * 2.5);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (target[i][j] - cur[i][j]) * k;
      const want = Math.min(1, Math.max(0, levelRef.current));
      level += (want - level) * (want > level ? 0.3 : 0.06);
      const pt = pointerRef.current;
      const kh = 1 - Math.exp(-dt * 6);
      hover += (pt.active - hover) * kh;
      px += (pt.x - px) * kh;
      py += (pt.y - py) * kh;
      gl.uniform2f(U.res, c.width, c.height);
      gl.uniform2f(U.center, w * centerX * dpr, h * (1 - centerY) * dpr);
      gl.uniform1f(U.orbR, orbSize * 0.33 * dpr);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.level, level);
      gl.uniform1f(U.flash, reduce ? 0 : flash);
      gl.uniform1f(U.hover, hover);
      energy += (ENERGY[m] - energy) * k;
      gl.uniform1f(U.energy, energy);
      gl.uniform1f(U.drift, reduce ? 0 : drift);
      gl.uniform2f(U.point, px, -py);
      U.c.forEach((l, i) => gl.uniform3f(l, cur[i][0], cur[i][1], cur[i][2]));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame(performance.now(), true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [variant, levelRef, pointerRef, centerY, centerX, orbSize, drift]);
  return <canvas ref={ref} className="jev-backdrop" aria-hidden="true" />;
}
