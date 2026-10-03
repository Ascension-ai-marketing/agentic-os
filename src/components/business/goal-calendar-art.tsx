import { useId } from "react";

type Scope = "week" | "month" | "quarter";

/** Calendar sheets illustrate the time horizon. They don't represent completed goals. */
export function GoalCalendarArt({ scope }: { scope: Scope }) {
  const shadow = useId().replace(/:/g, "");
  const sheets = scope === "quarter" ? 3 : 1;
  const rows = scope === "week" ? 1 : 4;
  return (
    <svg
      className={`goal-calendar-art is-${scope}`}
      viewBox="0 0 360 220"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={shadow} x="-50%" y="-50%" width="200%" height="220%">
          <feDropShadow dx="0" dy="9" stdDeviation="9" floodOpacity=".14" />
        </filter>
      </defs>
      <path className="goal-calendar-path" d="M20 181C92 181 78 192 160 192S258 177 340 177" />
      {Array.from({ length: sheets }, (_, index) => {
        const width = scope === "quarter" ? 146 : 220;
        const height = scope === "week" ? 106 : scope === "month" ? 161 : 137;
        const x = scope === "quarter" ? 29 + index * 78 : 70;
        const y = scope === "quarter" ? 25 + index * 17 : scope === "week" ? 62 : 25;
        const cellSize = scope === "quarter" ? 12 : 20;
        const gap = scope === "quarter" ? 5 : 7;
        const inset = (width - (cellSize * 7 + gap * 6)) / 2;
        return (
          <g
            className={`goal-calendar-sheet sheet-${index}`}
            key={index}
            style={{ animationDelay: `${index * -0.8}s` }}
          >
            <rect
              className="goal-calendar-paper"
              x={x}
              y={y}
              width={width}
              height={height}
              rx="12"
              filter={`url(#${shadow})`}
            />
            <path className="goal-calendar-rule" d={`M${x} ${y + 35}H${x + width}`} />
            <rect
              className="goal-calendar-heading"
              x={x + inset}
              y={y + 16}
              width={scope === "quarter" ? 36 : 65}
              height="5"
              rx="2.5"
            />
            <circle className="goal-calendar-pin" cx={x + width - inset - 5} cy={y + 18} r="3" />
            {Array.from({ length: rows * 7 }, (_, day) => (
              <rect
                key={day}
                className={`goal-calendar-day${day % 7 > 4 ? " is-weekend" : ""}`}
                x={x + inset + (day % 7) * (cellSize + gap)}
                y={y + 47 + Math.floor(day / 7) * (cellSize + gap)}
                width={cellSize}
                height={scope === "quarter" ? 11 : 16}
                rx="3"
              />
            ))}
            {scope === "week" && (
              <path
                className="goal-calendar-week-rule"
                d={`M${x + inset} ${y + 85}H${x + width - inset}`}
              />
            )}
            <rect
              className="goal-calendar-day-marker"
              x={x + inset + (index + 1) * (cellSize + gap)}
              y={y + 47 + (scope === "week" ? 0 : cellSize + gap)}
              width={cellSize}
              height={scope === "quarter" ? 11 : 16}
              rx="3"
            />
          </g>
        );
      })}
    </svg>
  );
}
