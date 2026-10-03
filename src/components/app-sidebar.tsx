import { useWorkspaceProfile } from "@/lib/workspace-profile";
import "./operator/workspace-settings.css";
import hermesLogo from "@/assets/hermes-face.png";
const defaultAvatar = "/operator-avatar.svg";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BrainCircuit,
  Globe2,
  Landmark,
  Palette,
  Settings,
  Waypoints,
  Menu,
  Inbox,
  CalendarDays,
  Bot,
  Orbit,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useOperator } from "@/lib/operator";
import "./operator/brand-refinements.css";
import "./operator/sidebar-profile.css";

import { ProviderOrbit } from "./operator/provider-orbit";
import { VoiceDock } from "./jev/voice-orb";

const primary = [
  { to: "/business", label: "Dashboard", icon: Landmark },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },

  { to: "/memory", label: "Memory", icon: BrainCircuit },
];
const tools = [
  { to: "/design", label: "Design", icon: Palette },
  { to: "/websites", label: "Website", icon: Globe2 },

  { to: "/agents/hermes", label: "Hermes", icon: Bot },
];
function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useWorkspaceProfile();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { state } = useOperator();
  const [name, setName] = useState("Operator");
  const [avatar, setAvatar] = useState(defaultAvatar);
  useEffect(() => {
    const update = () => {
      try {
        const savedName = localStorage.getItem("claude-os.operator-name.v1")?.trim();
        setName(savedName && savedName.toLowerCase() !== "operator" ? savedName : "Operator");
        const savedAvatar = localStorage.getItem("claude-os.avatar.v1");
        setAvatar(savedAvatar?.startsWith("data:image/") ? savedAvatar : defaultAvatar);
      } catch {
        setName("Operator");
        setAvatar(defaultAvatar);
      }
    };
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const pending = state.inbox.filter(
    (i) =>
      i.status === "open" &&
      i.category === "needs-you" &&
      state.settings.inboxAccounts?.[i.source] !== false &&
      !i.labelIds?.some((label) => ["DRAFT", "SENT", "SPAM", "TRASH"].includes(label)) &&
      (i.source !== "gmail" || !i.labelIds || i.labelIds.includes("INBOX")),
  ).length;
  const nav = (item: (typeof primary)[number]) => (
    <Link
      key={item.to}
      to={item.to as any}
      onClick={onNavigate}
      className={`op-nav-link ${path.startsWith(item.to) ? "active" : ""} ${item.to === "/design" ? "ws-nav-design" : item.to === "/websites" ? "ws-nav-websites" : item.to === "/agents/hermes" ? "ws-nav-hermes" : ""}`}
      aria-current={path.startsWith(item.to) ? "page" : undefined}
    >
      {item.to === "/agents/hermes" ? (
        <img
          src={hermesLogo}
          alt=""
          width={21}
          height={21}
          style={{ borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        <item.icon size={17} />
      )}
      <span>{item.label}</span>
      {item.to === "/inbox" && pending > 0 && <b>{pending}</b>}
    </Link>
  );
  return (
    <div className="op-sidebar-inner">
      <Link to="/business" className="op-brand ar-brand-refined" onClick={onNavigate}>
        <ProviderOrbit />
        <span>
          Agentic<span className="op-brand-os"> OS</span>
          <small>THINK BIGGER.</small>
        </span>
      </Link>
      <div className="op-nav-caption">WORKSPACE</div>
      <nav aria-label="Workspace">{primary.map(nav)}</nav>
      <div className="op-voice-slot">
        <VoiceDock />
      </div>
      <div className="op-nav-caption">TOOLS</div>
      <nav aria-label="Tools">
        {tools.map(nav)}
        {state.settings.openclaw && nav({ to: "/agents/openclaw", label: "OpenClaw", icon: Bot })}
        {state.settings.mission && nav({ to: "/dashboard", label: "Mission Control", icon: Orbit })}
      </nav>
      <div className="op-sidebar-bottom">
        {nav({ to: "/settings", label: "Settings", icon: Settings })}
        <Link
          to="/settings"
          hash="personal-profile"
          onClick={onNavigate}
          className="op-identity ar-sidebar-profile"
          aria-label={`${profile.name || name} — Personal profile`}
        >
          <img
            src={profile.avatar || avatar}
            alt={profile.name || name}
            width={36}
            height={36}
            onError={() => setAvatar(defaultAvatar)}
          />
          <div>
            {profile.name || name}
            <small>PERSONAL PROFILE</small>
          </div>
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
export function AppSidebar() {
  return (
    <aside className="op-sidebar hidden md:flex">
      <SidebarBody />
    </aside>
  );
}
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="md:hidden op-icon-button" aria-label="Open navigation">
          <Menu size={20} />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[250px] p-0" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <SidebarBody onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
