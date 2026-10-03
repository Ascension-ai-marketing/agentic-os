import { useId, useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import "./liquid-toggle.css";

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "size"> & {
  onCheckedChange?: (checked: boolean) => void;
  variant?: "default" | "success" | "warning" | "danger";
};

/** The supplied liquid switch, with controlled state and a filter unique to each instance. */
export function Toggle({ checked, defaultChecked = false, onCheckedChange, className, variant = "default", disabled, ...props }: ToggleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultChecked);
  const isChecked = checked ?? uncontrolled;
  const filterId = `liquid-${useId().replace(/:/g, "")}`;
  return (
    <span className={cn("liquid-toggle", className)} data-variant={variant} data-disabled={disabled || undefined}>
      <input {...props} type="checkbox" role="switch" checked={isChecked} disabled={disabled}
        onChange={event => { setUncontrolled(event.target.checked); onCheckedChange?.(event.target.checked); }} />
      <svg viewBox="0 0 52 32" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} x="-30%" y="-50%" width="160%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <circle cx="16" cy="16" r="10" style={{ transformOrigin: "16px 16px", transform: `translateX(${isChecked ? 12 : 0}px) scale(${isChecked ? 0 : 1})` }} />
          <circle cx="36" cy="16" r="10" style={{ transformOrigin: "36px 16px", transform: `translateX(${isChecked ? 0 : -12}px) scale(${isChecked ? 1 : 0})` }} />
        </g>
      </svg>
    </span>
  );
}
