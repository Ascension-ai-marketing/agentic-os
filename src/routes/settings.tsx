import { useEffect, useRef, useState } from "react";
import { FishSignup } from "@/components/jev/fish-signup";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Brain, Plug, Settings2, UserRound, Cpu } from "lucide-react";
import {
  profileChanges,
  useWorkspaceProfile,
  type WorkspaceProfile,
} from "@/lib/workspace-profile";
import { PersonalProfileFields, ToolDiscovery } from "@/components/operator/workspace-onboarding";
import { AccountConnectionsContent } from "@/components/operator/accounts-hub";
import { OperatorPreferences } from "@/components/operator/preferences";
import { setCurrency } from "@/lib/currency";
import "@/components/operator/workspace-settings.css";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Agentic OS" },
      { name: "description", content: "Your profile, connections and workspace preferences." },
    ],
  }),
  component: SettingsPage,
});
const tabs = [
  { id: "personal-profile", label: "Personal profile", Icon: UserRound },
  { id: "connections", label: "Connections", Icon: Plug },
  { id: "ai-tools", label: "AI tools", Icon: Cpu },
  { id: "preferences", label: "Workspace", Icon: Settings2 },
];
function SettingsPage() {
  const profile = useWorkspaceProfile();
  const base = useRef(profile.profile);
  const [section, setSection] = useState("personal-profile"),
    [draft, setDraft] = useState(profile.profile),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === hash)) setSection(hash);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!dirty) {
      base.current = profile.profile;
      setDraft(profile.profile);
    }
  }, [profile.profile, dirty]);
  function change(patch: Partial<WorkspaceProfile>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaved(false);
  }
  async function save() {
    if (busy || !profile.data) return;
    setBusy(true);
    setError("");
    try {
      const result = await profile.save(profileChanges(base.current, draft));
      setCurrency(result.currency);
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ws-settings">
      <header className="ws-settings-heading">
        <div>
          <span className="ws-eyebrow">MAKE IT YOURS</span>
          <h1>
            Settings<span>.</span>
          </h1>
          <p>Manage your profile and workspace preferences.</p>
        </div>
        <Link to="/setup" className="ws-settings-setup">
          <Cpu size={16} />
          {profile.profile.onboardingCompletedAt ? "Review your setup" : "Set up your Agentic OS"}
          <ArrowUpRight size={15} />
        </Link>
      </header>
      <nav className="ws-settings-tabs" aria-label="Settings sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={section === t.id ? "page" : undefined}
            onClick={() => {
              setSection(t.id);
              window.history.replaceState(null, "", `#${t.id}`);
            }}
          >
            <t.Icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>
      <section id={section} className="ws-settings-panel">
        {section === "personal-profile" && (
          <>
            <header>
              <h2>Your personal context.</h2>
              <p>
                Your profile is remembered across the OS and available to Chat when Personal context
                is enabled.
              </p>
            </header>
            {profile.isLoading ? (
              <p>Loading your profile…</p>
            ) : profile.error ? (
              <p role="alert" className="ws-error">
                Your profile couldn’t load. Refresh to try again.
              </p>
            ) : (
              <>
                <PersonalProfileFields value={draft} onChange={change} disabled={busy} compact />
                {error && (
                  <p className="ws-error" role="alert">
                    {error}
                  </p>
                )}
                <footer className="ws-settings-save">
                  <span role="status">
                    {saved ? (
                      <>
                        <Check size={14} />
                        Profile saved
                      </>
                    ) : dirty ? (
                      "Unsaved changes"
                    ) : profile.profile.updatedAt ? (
                      "Saved on this computer"
                    ) : (
                      "No profile saved yet"
                    )}
                  </span>
                  <button
                    type="button"
                    className="ws-primary"
                    disabled={busy || !dirty}
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : "Save profile"}
                  </button>
                </footer>
              </>
            )}
          </>
        )}
        {section === "connections" && (
          <>
            <header>
              <h2>Your accounts.</h2>
              <p>
                Money, audience, messages and calendar. Each connection shows what it can access.
              </p>
            </header>
            <AccountConnectionsContent />
            <FishSignup always label="Get Fish Audio: the voice of your OS" />
            <div className="ws-settings-memory-link">
              <Brain size={20} />
              <div>
                <strong>Connect your memory</strong>
                <p>Bring in local agents, documents, conversations and photos.</p>
              </div>
              <Link to="/memory">
                Open Memory <ArrowUpRight size={14} />
              </Link>
            </div>
          </>
        )}
        {section === "ai-tools" && (
          <>
            <header>
              <h2>Your choice of intelligence.</h2>
              <p>
                Installed tools and available models are checked separately. Choose your model in
                Chat.
              </p>
            </header>
            <ToolDiscovery />
            <div className="ws-settings-memory-link">
              <Cpu size={20} />
              <div>
                <strong>Ready for a conversation?</strong>
                <p>Your saved chats share the memory sources you enable.</p>
              </div>
              <Link to="/chat">
                Open Chat <ArrowUpRight size={14} />
              </Link>
            </div>
          </>
        )}
        {section === "preferences" && (
          <>
            <header>
              <h2>Room for what you use.</h2>
              <p>Keep your everyday tools close. Add advanced views when you need them.</p>
            </header>
            <OperatorPreferences />
          </>
        )}
      </section>
    </div>
  );
}
