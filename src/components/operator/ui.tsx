import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowUpRight, Loader2, Plus, MessageSquare, Send } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { askOperator } from "@/lib/operator";
export function PageHeading({
  eyebrow,
  title,
  accent,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="op-page-heading">
      <div>
        <div className="op-eyebrow">{eyebrow}</div>
        <h1>
          {title} {accent && <span>{accent}</span>}
        </h1>
        <p>{description}</p>
      </div>
      <div className="op-heading-actions">{children}</div>
    </header>
  );
}
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`op-panel ${className}`}>{children}</section>;
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="op-empty">
      <span className="op-empty-icon">{icon || <Plus size={25} />}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="op-modal">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`op-notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
      {children}
    </div>
  );
}
export function Busy() {
  return <Loader2 size={15} className="animate-spin" />;
}
export function ConnectionNote({ kind }: { kind: "email" | "calendar" }) {
  return (
    <div className="op-connection-note">
      <span className="op-status-dot" />
      <span>
        {kind === "email" ? "Gmail & Outlook" : "Google & Outlook Calendar"}
        <small>Not connected · local workspace ready</small>
      </span>
      <Link to="/settings" hash="connections" aria-label="View connection status">
        <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}
export function AskBar({ placeholder, context = "" }: { placeholder: string; context?: string }) {
  const [value, setValue] = useState("");
  return <form className="op-ask-bar" onSubmit={e=>{e.preventDefault();askOperator(value,context,!!value.trim());setValue("")}}>
    <MessageSquare size={17}/><input aria-label="Ask about this page" value={value} onChange={e=>setValue(e.target.value)} placeholder={placeholder}/>
    <button type="submit" aria-label="Open page chat"><Send size={15}/></button>
  </form>;
}
