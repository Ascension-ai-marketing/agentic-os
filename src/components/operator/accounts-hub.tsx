import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Mail } from "lucide-react";
import { Modal } from "./ui";
import { WorkAccountConnectionsPanel } from "./account-connections";
import { ConnectionsPanel } from "../business/connections-panel";
import "./accounts-hub.css";

export function AccountsHub() {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<"work" | "business">("business");
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setGroup(detail?.group === "work" ? "work" : "business");
      setOpen(true);
    };
    window.addEventListener("agentic:accounts", show);
    const params = new URLSearchParams(window.location.search);
    if (params.has("connected") || params.has("connections") || params.has("accounts") || params.get("view") === "connections") {
      setGroup(params.get("view") === "connections" || params.get("accounts") === "business" || location.pathname === "/business" ? "business" : "work");
      setOpen(true);
    }
    return () => window.removeEventListener("agentic:accounts", show);
  }, []);
  function close() {
    setOpen(false);
    const url = new URL(window.location.href);
    for (const key of ["connected", "connections", "accounts"]) url.searchParams.delete(key);
    if (url.searchParams.get("view") === "connections") url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }
  return <Modal open={open} onClose={close} title="Your connected world" description="One place for the accounts that power your workspace.">
    <AccountConnectionsContent key={group} initialGroup={group}/>
    <Link to="/settings" hash="connections" onClick={close} className="ws-text-button">Manage connections in Settings ↗</Link>
  </Modal>;
}

export function AccountConnectionsContent({ initialGroup = "business" }: { initialGroup?: "business" | "work" }) {
  const [group, setGroup] = useState(initialGroup);
  return <div className="agentic-accounts-hub">
    <div className="agentic-account-groups" role="tablist" aria-label="Account groups">
      <button type="button" role="tab" aria-selected={group === "business"} onClick={() => setGroup("business")}><Building2 size={15}/>Money & audience</button>
      <button type="button" role="tab" aria-selected={group === "work"} onClick={() => setGroup("work")}><Mail size={15}/>Inbox & calendar</button>
    </div>
    <div role="tabpanel" aria-label={group === "business" ? "Business accounts" : "Work accounts"}>
      {group === "business" ? <ConnectionsPanel/> : <WorkAccountConnectionsPanel/>}
    </div>
  </div>;
}
