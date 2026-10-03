import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import "./animated-buttons.css";

export const RainbowButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function RainbowButton({ children, className, type = "button", ...props }, ref) {
    return (
      <button {...props} ref={ref} type={type} className={cn("rainbow-button", className)}>
        <span className="rainbow-button__content">{children}</span>
      </button>
    );
  },
);
