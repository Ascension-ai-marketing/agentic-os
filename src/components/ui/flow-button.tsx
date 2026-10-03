import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import "./animated-buttons.css";

export interface FlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
}

export const FlowButton = forwardRef<HTMLButtonElement, FlowButtonProps>(function FlowButton(
  { text = "Continue", children, className, type = "button", ...props },
  ref,
) {
  return (
    <button {...props} ref={ref} type={type} className={cn("flow-button", className)}>
      <span className="flow-button__fill" aria-hidden="true" />
      <ArrowRight className="flow-button__arrow flow-button__arrow--enter" aria-hidden="true" />
      <span className="flow-button__text">{children ?? text}</span>
      <ArrowRight className="flow-button__arrow flow-button__arrow--exit" aria-hidden="true" />
    </button>
  );
});
