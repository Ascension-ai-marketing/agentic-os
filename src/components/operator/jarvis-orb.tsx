import { useId, type CSSProperties } from "react";

/** A bright glass sphere with luminous currents, responsive to the live audio level. */
export function JarvisOrb({ level = 0, phase = "idle" }: { level?: number; phase?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <span
      className="jarvis-orb"
      data-phase={phase}
      style={{ "--orb-energy": Math.min(1, Math.max(0, level)) } as CSSProperties}
      aria-hidden="true"
    >
      <svg className="jarvis-orb-art" viewBox="0 0 300 300" fill="none">
        <defs>
          <radialGradient id={`${id}-body`} cx=".35" cy=".3" r=".77">
            <stop stopColor="#ffffff" />
            <stop offset=".3" stopColor="#d8fbff" />
            <stop offset=".56" stopColor="#8ee1f1" />
            <stop offset=".76" stopColor="#8680ef" />
            <stop offset=".92" stopColor="#7964ce" />
            <stop offset="1" stopColor="#b9c9ff" />
          </radialGradient>
          <radialGradient id={`${id}-core`} cx=".44" cy=".43" r=".55">
            <stop stopColor="#fff" stopOpacity=".97" />
            <stop offset=".22" stopColor="#f2ffff" stopOpacity=".87" />
            <stop offset=".58" stopColor="#a4fcff" stopOpacity=".3" />
            <stop offset="1" stopColor="#b3b1ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id={`${id}-current`}
            x1="69"
            y1="75"
            x2="233"
            y2="226"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f9ffff" />
            <stop offset=".31" stopColor="#84f6ff" />
            <stop offset=".61" stopColor="#b3a7ff" />
            <stop offset=".84" stopColor="#f7d8ff" />
            <stop offset="1" stopColor="#edffff" />
          </linearGradient>
          <linearGradient
            id={`${id}-edge`}
            x1="54"
            y1="62"
            x2="232"
            y2="253"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f6ffff" />
            <stop offset=".4" stopColor="#cbffff" stopOpacity=".5" />
            <stop offset=".7" stopColor="#a895ff" stopOpacity=".2" />
            <stop offset="1" stopColor="#ecf6ff" />
          </linearGradient>
          <radialGradient id={`${id}-aura`}>
            <stop offset=".43" stopColor="#91f3fa" stopOpacity=".2" />
            <stop offset=".7" stopColor="#a392ff" stopOpacity=".09" />
            <stop offset="1" stopColor="#aac9ff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}-clip`}>
            <circle cx="150" cy="150" r="101" />
          </clipPath>
          <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle className="jarvis-orb-aura" cx="150" cy="150" r="149" fill={`url(#${id}-aura)`} />
        <g className="jarvis-orb-orbits" stroke={`url(#${id}-edge)`}>
          <ellipse
            cx="150"
            cy="150"
            rx="116"
            ry="106"
            transform="rotate(-36 150 150)"
            strokeOpacity=".5"
            strokeWidth=".7"
          />
          <path d="M68 74C119 15 221 38 263 124" strokeOpacity=".5" strokeWidth=".7" />
          <circle cx="65" cy="79" r="2.2" fill="#e5ffff" stroke="none" />
        </g>
        <g className="jarvis-orb-sphere">
          <circle cx="150" cy="150" r="101" fill={`url(#${id}-body)`} />
          <g clipPath={`url(#${id}-clip)`}>
            <g className="jarvis-orb-currents" stroke={`url(#${id}-current)`}>
              <path
                d="M37 142C101 237 102 72 187 111C259 144 185 248 292 204"
                strokeWidth="27"
                strokeOpacity=".65"
                filter={`url(#${id}-soft)`}
              />
              <path
                d="M32 181C91 281 126 54 205 96C276 134 169 261 282 194"
                strokeWidth="12"
                strokeOpacity=".8"
              />
              <path
                d="M26 160C81 244 109 94 179 116C258 141 171 241 278 211"
                strokeWidth="3"
                strokeOpacity=".95"
              />
              <path
                d="M54 60C30 158 223 43 226 151C229 219 102 230 114 278"
                strokeWidth="19"
                strokeOpacity=".42"
                filter={`url(#${id}-soft)`}
              />
              <path
                d="M57 68C48 148 214 56 222 147C228 216 106 226 114 274"
                strokeWidth="2"
                strokeOpacity=".88"
              />
              {Array.from({ length: 9 }, (_, i) => (
                <path
                  key={i}
                  d={`M${35 + i * 3} ${122 + i * 4}C${90 + i * 2} ${239 - i * 2} ${132 + i * 2} ${46 + i * 8} ${210 + i * 3} ${104 + i * 5}S${188 + i * 4} 239 283 209`}
                  strokeWidth=".7"
                  strokeOpacity={0.18 + i * 0.035}
                />
              ))}
            </g>
            <circle
              className="jarvis-orb-light"
              cx="147"
              cy="144"
              r="89"
              fill={`url(#${id}-core)`}
            />
            <ellipse
              cx="116"
              cy="76"
              rx="38"
              ry="10"
              transform="rotate(-26 116 76)"
              fill="#fff"
              fillOpacity=".53"
              filter={`url(#${id}-soft)`}
            />
            <path
              d="M68 180C99 264 200 269 237 189"
              stroke="#d8ccff"
              strokeOpacity=".7"
              strokeWidth="1.2"
            />
          </g>
          <circle cx="150" cy="150" r="101" stroke={`url(#${id}-edge)`} strokeWidth="1.3" />
          <path
            d="M65 118A91 91 0 0 1 152 58"
            stroke="#f6ffff"
            strokeOpacity=".84"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </span>
  );
}
