import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SetupAgentConnections } from "./setup-agent-connections";
import { SetupScanConnections, connectionStages } from "./setup-scan-connections";
import { ThemeToggle } from "@/components/theme-toggle";
import { FlowButton } from "@/components/ui/flow-button";
import codexLogo from "@/assets/logos/codex.png";
import openaiLogo from "@/assets/logos/openai.png";
import claudeLogo from "@/assets/claude-logo.png";
import hermesLogo from "@/assets/hermes-face.png";
import deepseekLogo from "@/assets/logo-deepseek.svg";
import { SetupLandscape } from "./setup-landscape";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Upload,
  RefreshCw,
  Cpu,
  ChevronDown,
  X,
  Image as ImageIcon,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import {
  profileChanges,
  useWorkspaceProfile,
  type WorkspaceProfile,
} from "@/lib/workspace-profile";
import { useBusinessWorkspace, type BusinessProfile } from "@/lib/business-workspace";
import { goalPeriodState, type GoalHorizon } from "@/lib/goal-periods";
import { operatorRequest, useOperator } from "@/lib/operator";
import { setCurrency } from "@/lib/currency";
import { SourceBrand } from "./source-brand";
import { AudienceLogo } from "../business/audience-logo";
import { BusinessLogo } from "../business/connections-panel";
import { OnboardingMemorySources } from "./onboarding-memory-sources";
import { PhotoIndexSetup } from "./photo-index-setup";
import calendarLogo from "@/assets/logos/googlecalendar.svg";
import { ProviderOrbit } from "./provider-orbit";
import { ProfileLinks } from "./profile-links";
import { ExistingConnectionsPanel } from "./account-connections";
import {
  personalContext,
  personalContextPatch,
  prepareProfilePhoto,
  setupDisplayStep,
  setupStoredStep,
  setupDraftStep,
  editableProfileLinks,
} from "@/lib/workspace-onboarding-state";
import { parsePublicProfiles } from "@/lib/workspace-profile-links";
import "./workspace-onboarding.css";
import "./workspace-onboarding-calm.css";
import "./workspace-onboarding-frame.css";

const steps = [
  {
    title: "About you",
    heading: "Build your OS.",
    copy: "Help your OS understand you and the work that matters.",
  },
  {
    title: "Connections",
    heading: "Connect your world.",
    copy: "",
  },
  { title: "Goals", heading: "What’s next?", copy: "Give your OS something to work towards." },
];
const profileResources = {
  life: "https://wirehaired-actress-399.notion.site/Build-Your-Life-Profile-3dde8d6bd1378110815ffc325bf42885",
  business:
    "https://wirehaired-actress-399.notion.site/Build-Your-Business-Profile-3dde8d6bd13781ce9a77c8bf1ab835e4",
};
const toolLogos: Record<string, string> = {
  codex: codexLogo,
  chatgpt: openaiLogo,
  claude: claudeLogo,
  hermes: hermesLogo,
  deepseek: deepseekLogo,
};
const setupDraftKey = "agentic.setup.draft.v1";
/** "Europe/London" reads as London: the default city for weather and local context. */
const cityFromZone = (zone: string) => (zone.includes("/") ? zone.split("/").pop()!.replaceAll("_", " ") : "");
const currencies = [
  "USD",
  "GBP",
  "EUR",
  "AED",
  "CAD",
  "AUD",
  "INR",
  "SGD",
  "CHF",
  "JPY",
  "BRL",
  "ZAR",
];
const zones = [
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

export function PersonalProfileFields({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: WorkspaceProfile;
  onChange: (patch: Partial<WorkspaceProfile>) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRequest = useRef(0);
  const hourlyMaximum = useRef(1000);
  hourlyMaximum.current = Math.max(hourlyMaximum.current, value.hourlyRate || 0);
  const [context, setContext] = useState(() => personalContext(value));
  const lastContext = useRef({
    about: value.about,
    responsePreferences: value.responsePreferences,
  });
  useEffect(() => {
    if (
      lastContext.current.about !== value.about ||
      lastContext.current.responsePreferences !== value.responsePreferences
    ) {
      setContext(personalContext(value));
      lastContext.current = { about: value.about, responsePreferences: value.responsePreferences };
    }
  }, [value.about, value.responsePreferences]);
  useEffect(
    () => () => {
      photoRequest.current++;
    },
    [],
  );
  async function photo(file?: File) {
    if (!file) return;
    const request = ++photoRequest.current;
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const avatar = await prepareProfilePhoto(file);
      if (request === photoRequest.current) onChange({ avatar });
    } catch (cause) {
      if (request === photoRequest.current) setPhotoError((cause as Error).message);
    } finally {
      if (request === photoRequest.current) setPhotoBusy(false);
    }
  }
  return (
    <div className="ws-profile-fields">
      <div className="ws-profile-intro">
        <div className="ws-profile-photo">
          <img
            src={value.avatar || "/operator-avatar.svg"}
            alt={value.name ? `${value.name}'s profile` : "Your profile"}
          />
          <div>
            <label className="ws-photo-button">
              {photoBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {photoBusy ? "Resizing…" : "Add a photo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Upload profile photo"
                disabled={disabled || photoBusy}
                onChange={(event) => {
                  void photo(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <span>Up to 20 MB · resized on your device</span>
            {value.avatar && (
              <button
                type="button"
                disabled={disabled || photoBusy}
                onClick={() => {
                  photoRequest.current++;
                  onChange({ avatar: "" });
                }}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        <label className="ws-name-field">
          <span>Your name</span>
          <input
            autoComplete="given-name"
            placeholder="What should we call you?"
            maxLength={160}
            value={value.name}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
      </div>
      {photoError && (
        <p role="alert" className="ws-error">
          {photoError}
        </p>
      )}
      <div className="ws-field-grid">
        <label className="ws-wide ws-personal-context">
          <span>
            A little about you <small>Optional</small>
          </span>
          <textarea
            rows={3}
            maxLength={6000}
            value={context}
            disabled={disabled}
            placeholder="Share a little about your life. How do you like to work together?"
            onChange={(event) => {
              const text = event.target.value;
              setContext(text);
              const patch = personalContextPatch(text);
              lastContext.current = patch;
              onChange(patch);
            }}
          />
        </label>
      </div>
      <details className="ws-details ws-personal-settings" open={compact ? true : undefined}>
        <summary>
          Your time & preferences{" "}
          <span>
            {value.currency} · {value.timeZone.replaceAll("_", " ")}
          </span>
          <ChevronDown size={14} />
        </summary>
        <div className="ws-field-grid">
          <label>
            <span>Your timezone</span>
            <input
              list="workspace-timezones"
              aria-label="Your timezone"
              value={value.timeZone}
              disabled={disabled}
              onChange={(event) => onChange({ timeZone: event.target.value })}
            />
            <datalist id="workspace-timezones">
              {[...new Set([value.timeZone, ...zones])].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Display currency</span>
            <select
              value={value.currency}
              disabled={disabled}
              onChange={(event) => onChange({ currency: event.target.value })}
            >
              {currencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          <div className="ws-wide ws-hourly-field">
            <div className="ws-hourly-heading">
              <label htmlFor="workspace-hourly-value">What’s an hour of your time worth?</label>
              <span>Optional</span>
            </div>
            <div className="ws-hourly-control">
              <input
                type="range"
                min={0}
                max={hourlyMaximum.current}
                step={10}
                value={value.hourlyRate || 0}
                disabled={disabled}
                aria-label="Hourly value slider"
                aria-valuetext={
                  value.hourlyRate === null
                    ? "Not set"
                    : `${value.currency} ${value.hourlyRate} per hour`
                }
                onChange={(event) => onChange({ hourlyRate: Number(event.target.value) })}
              />
              <div className="ws-money-input">
                <span>{value.currency}</span>
                <input
                  id="workspace-hourly-value"
                  type="number"
                  min={0}
                  max={1000000}
                  step={1}
                  inputMode="decimal"
                  placeholder="Not set"
                  value={value.hourlyRate ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      hourlyRate: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="ws-hourly-scale">
              <span>0</span>
              <span>{hourlyMaximum.current.toLocaleString()} / hour</span>
            </div>
            <p className="ws-muted">
              Used to estimate the value of time saved. You can change it later.
            </p>
          </div>
        </div>
      </details>
      {compact && (
        <ProfileLinks
          links={value.publicProfiles || []}
          onChange={(publicProfiles) => onChange({ publicProfiles })}
          disabled={disabled}
          summaryLabel="Social profiles & website"
        />
      )}
    </div>
  );
}

const socialPlatforms = [
  {
    label: "YouTube",
    placeholder: "https://youtube.com/@yourchannel",
    host: /(^|\.)youtube\.com$/,
  },
  { label: "Instagram", placeholder: "https://instagram.com/you", host: /(^|\.)instagram\.com$/ },
  { label: "LinkedIn", placeholder: "https://linkedin.com/in/you", host: /(^|\.)linkedin\.com$/ },
  { label: "Website", placeholder: "https://yourwebsite.com", host: /^$/ },
  { label: "TikTok", placeholder: "https://tiktok.com/@you", host: /(^|\.)tiktok\.com$/ },
  { label: "X", placeholder: "https://x.com/you", host: /(^|\.)(x|twitter)\.com$/ },
];

function SetupSocialLinks({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: WorkspaceProfile;
  onChange: (patch: Partial<WorkspaceProfile>) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const links = value.publicProfiles || [];
  const used = new Set<number>();
  const rows = socialPlatforms.map((platform) => {
    const index = links.findIndex((link, position) => {
      if (used.has(position)) return false;
      if (link.label.toLowerCase() === platform.label.toLowerCase()) return true;
      try {
        return platform.host.test(new URL(link.url).hostname);
      } catch {
        return false;
      }
    });
    if (index >= 0) used.add(index);
    return { ...platform, index };
  });
  return (
    <section className={`ws-social-profiles${compact ? " is-compact" : ""}`}>
      <header>
        <h2>Your social profiles</h2>
      </header>
      {!compact && <p className="ws-muted">Profile links identify your accounts. Live numbers need a supported connection.</p>}
      <div className="ws-field-grid">
        {rows.filter(row => !compact || ["Instagram", "TikTok", "LinkedIn"].includes(row.label)).map(({ label, placeholder, index }) => (
          <label key={label}>
            <span>{["Instagram", "LinkedIn", "TikTok", "YouTube"].includes(label) && <AudienceLogo platform={label.toLowerCase() as "instagram" | "linkedin" | "tiktok" | "youtube"} />}{label}</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={2048}
              aria-label={`${label} profile URL`}
              placeholder={placeholder}
              value={index < 0 ? "" : links[index].url}
              disabled={disabled || (index < 0 && links.length >= 8)}
              onChange={(event) => {
                const url = event.target.value;
                const next = [...links];
                if (index >= 0) {
                  if (!url) next.splice(index, 1);
                  else next[index] = { label, url };
                } else if (url) next.push({ label, url });
                onChange({ publicProfiles: next });
              }}
            />
          </label>
        ))}
        {links.map((link, index) =>
          compact || used.has(index) ? null : (
            <label key={index}>
              <span>{link.label}</span>
              <input
                type="url"
                inputMode="url"
                maxLength={2048}
                value={link.url}
                disabled={disabled}
                onChange={(event) => {
                  const next = [...links];
                  if (!event.target.value) next.splice(index, 1);
                  else next[index] = { label: link.label, url: event.target.value };
                  onChange({ publicProfiles: next });
                }}
              />
            </label>
          ),
        )}
      </div>
      {links.length >= 8 && (
        <p className="ws-muted">All eight profile spaces are in use. Clear a URL to add another.</p>
      )}
    </section>
  );
}

export function ToolDiscovery({ compact = false }: { compact?: boolean }) {
  const discovery = useQuery<{
    tools: Array<{ id: string; name: string; installed: boolean; detail: string }>;
    providers: Array<{ id: string; name: string; configured: boolean }>;
  }>({
    queryKey: ["setup-discovery"],
    queryFn: () => operatorRequest("/setup/discovery"),
    staleTime: 30000,
    retry: 1,
  });
  const models = useQuery<{
    models: Array<{ key: string; label: string }>;
    statuses: Array<{ id: string; ready: boolean; detail: string }>;
  }>({
    queryKey: ["setup-model-status"],
    queryFn: () => operatorRequest("/models"),
    staleTime: 60000,
    retry: 1,
  });
  const [expanded, setExpanded] = useState(false);
  const tools = discovery.data?.tools || [];
  const shown = expanded ? tools : tools.filter((t) => t.installed);
  return (
    <section className={`ws-discovery${compact ? " is-compact" : ""}`} aria-label="Your AI tools">
      <header>
        <div>
          <h3>Your AI tools</h3>
          <p>
            {discovery.isPending
              ? "Checking this computer…"
              : compact
                ? "Installed apps. Connections checked separately."
                : "Installed apps and available connections are checked separately."}
          </p>
        </div>
        <button
          type="button"
          className="ws-icon"
          aria-label="Detect tools again"
          disabled={discovery.isFetching || models.isFetching}
          onClick={() => {
            void discovery.refetch();
            void models.refetch();
          }}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {discovery.isError && (
        <p className="ws-error" role="alert">
          Tool detection is unavailable. Try again.
        </p>
      )}
      <div className="ws-tools">
        {shown.map((t) => {
          const status = models.data?.statuses.find((s) => s.id === t.id);
          return (
            <div className="ws-tool" key={t.id} title={t.detail}>
              <span className={`ws-tool-mark is-${t.id}`} aria-hidden="true">
                {toolLogos[t.id] ? <img src={toolLogos[t.id]} alt="" /> : <Cpu size={17} />}
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {models.isPending
                    ? "Checking connection…"
                    : models.isError
                      ? "Connection check unavailable"
                      : status?.ready
                        ? "Configured for chat"
                        : t.installed
                          ? status
                            ? "Installed · not connected"
                            : "Installed · chat not checked"
                          : "Not detected"}
                </small>
              </div>
              <span className={status?.ready ? "ws-status ready" : "ws-status"}>
                {models.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : status?.ready ? (
                  <Check size={12} />
                ) : t.installed ? (
                  "Found"
                ) : (
                  "Optional"
                )}
              </span>
            </div>
          );
        })}
      </div>
      {discovery.isSuccess && !shown.length && (
        <p className="ws-muted">No local AI tools detected. You can still set up your workspace.</p>
      )}
      <button
        type="button"
        className="ws-text-button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Show installed tools" : "See all supported tools"}
        <ChevronDown size={13} />
      </button>
      <div className="ws-discovery-note">
        <Cpu size={15} />
        <span>
          {models.isPending
            ? "Checking available models…"
            : models.isError
              ? "Model discovery is unavailable. Retry when your tools are ready."
              : models.data?.models.length
                ? compact
                  ? "Choose your model in Chat. Change it any time."
                  : "Choose your model in Chat. You can change it whenever you like."
                : "Configure a provider or start a local model to enable Chat."}
        </span>
      </div>
      {!compact && tools.find((t) => t.id === "chatgpt")?.installed && (
        <p className="ws-muted">
          ChatGPT detected. Add its export in Memory to bring your conversations here.
        </p>
      )}
    </section>
  );
}

function SetupConnections() {
  const archive = useQuery<{
    total: number;
    accounts: Array<{
      provider: "gmail" | "outlook";
      account: string;
      status: "importing" | "complete" | "needs-attention" | "paused";
      count: number;
    }>;
  }>({
    queryKey: ["mail-archive-status"],
    queryFn: () => operatorRequest("/mail-archive/status"),
    staleTime: 15000,
    retry: 1,
    refetchInterval: (query) =>
      query.state.data?.accounts.some((account) => account.status === "importing") ? 3000 : false,
  });
  return (
    <div className="ws-connections-step">
      <section className="ws-existing-tools">
        <ExistingConnectionsPanel />
      </section>
      <div className="ws-account-choices">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("agentic:accounts", { detail: { group: "work" } }))
          }
        >
          <span className="ws-account-logos">
            <SourceBrand id="gmail" size={23} />
            <SourceBrand id="outlook" size={23} />
            <img src={calendarLogo} alt="Google Calendar" />
          </span>
          <span>
            <strong>Inbox & calendar</strong>
            <small>Email, meetings and messages</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("agentic:accounts", { detail: { group: "business" } }),
            )
          }
        >
          <span className="ws-account-logos">
            <BusinessLogo provider="mercury" />
            <BusinessLogo provider="youtube" />
          </span>
          <span>
            <strong>Money & audience</strong>
            <small>Only the platforms you choose</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      </div>
      {!!archive.data?.accounts.length && (
        <details className="ws-mail-archive">
          <summary>
            <SourceBrand id="email" size={20} />
            <strong>{archive.data.total.toLocaleString()} emails archived</strong>
            <span>
              {archive.data.accounts.some((account) => account.status === "needs-attention")
                ? "Needs attention"
                : archive.data.accounts.some((account) => account.status === "importing")
                  ? "Importing"
                  : archive.data.accounts.some((account) => account.status === "paused")
                    ? "Paused"
                    : "Ready"}
            </span>
            <ChevronDown size={13} />
          </summary>
          {archive.data.accounts.map((account) => (
            <div key={`${account.provider}:${account.account}`}>
              <span>{account.account}</span>
              <small>
                {account.count.toLocaleString()} ·{" "}
                {account.status === "importing"
                  ? "Importing"
                  : account.status === "complete"
                    ? "Import complete"
                    : account.status === "paused"
                      ? "History paused"
                      : "Needs attention"}
              </small>
            </div>
          ))}
          <p>
            Imported through your existing assistant connection. Direct account sync is configured
            separately.
          </p>
        </details>
      )}
    </div>
  );
}

function SetupPhoto({
  value,
  onChange,
  disabled,
}: {
  value: WorkspaceProfile;
  onChange: (patch: Partial<WorkspaceProfile>) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  async function choose(file?: File) {
    if (!file) return;
    const request = ++version.current;
    setBusy(true);
    setError("");
    try {
      const avatar = await prepareProfilePhoto(file);
      if (request === version.current) onChange({ avatar });
    } catch (cause) {
      if (request === version.current) setError((cause as Error).message);
    } finally {
      if (request === version.current) setBusy(false);
    }
  }
  return (
    <div className="ws-direct-photo">
      <label>
        <img src={value.avatar || "/operator-avatar.svg"} alt="Your profile" />
        <span>{busy ? "Resizing…" : value.avatar ? "Change photo" : "Add photo"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Upload profile photo"
          disabled={disabled || busy}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

async function celebrateSetup() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  const colors = ["#cab1f0", "#9ee7d5", "#fff7eb", "#efb9cf", "#f2d18e"];
  confetti({
    particleCount: 160,
    spread: 110,
    startVelocity: 48,
    origin: { y: 0.55 },
    colors,
    zIndex: 10000,
    disableForReducedMotion: true,
  });
  window.setTimeout(() => {
    for (const x of [0.1, 0.9])
      confetti({
        particleCount: 90,
        angle: x < 0.5 ? 60 : 120,
        spread: 70,
        origin: { x, y: 0.7 },
        colors,
        zIndex: 10000,
        disableForReducedMotion: true,
      });
  }, 350);
}

export function WorkspaceOnboarding() {
  const personal = useWorkspaceProfile(),
    business = useBusinessWorkspace(),
    operator = useOperator(),
    navigate = useNavigate();
  const [connectionStage, setConnectionStage] = useState(0);
  const [connectionBusy, setConnectionBusy] = useState<"" | "scan" | "import" | "granola">("");
  const [connectionsScanned, setConnectionsScanned] = useState(false);
  const [pendingImports, setPendingImports] = useState(0);
  const [imported, setImported] = useState<string[]>([]);
  const importSelected = useRef<(() => Promise<boolean>) | null>(null);
  const [step, setStep] = useState(0),
    [draft, setDraft] = useState(personal.profile),
    [businessDraft, setBusinessDraft] = useState<BusinessProfile>({});
  const [goals, setGoals] = useState<Record<GoalHorizon, { id?: string; title: string }>>({
    quarter: { title: "" },
    month: { title: "" },
    week: { title: "" },
  });
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const initialized = useRef(false),
    initialGoals = useRef(goals);
  const draftBase = useRef<string | undefined>(undefined),
    backupSaved = useRef(false);
  const personalBase = useRef(personal.profile),
    businessBase = useRef<BusinessProfile>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const panelOrigin = useRef<HTMLElement | null>(null);
  function openPanel(next: "profile" | "apps" | "agents" | "memory") {
    panelOrigin.current = document.activeElement as HTMLElement | null;
    setPanel(next);
  }
  const [panel, setPanel] = useState<"profile" | "apps" | "agents" | "memory" | null>(null);
  useEffect(() => {
    document.title = `${steps[step]?.title || "Setup"} · Set up your Agentic OS`;
    if (initialized.current) {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [step]);
  const loaded = !!personal.data && !!business.data;
  useEffect(() => {
    if (!loaded || initialized.current) return;
    initialized.current = true;
    personalBase.current = personal.profile;
    businessBase.current = business.data!.profile;
    setDraft(personal.profile);
    setBusinessDraft(business.data!.profile);
    setStep(
      personal.profile.onboardingCompletedAt
        ? 0
        : setupDisplayStep(personal.profile.onboardingStep),
    );
    const current = Object.fromEntries(
      (["quarter", "month", "week"] as const).map((horizon) => {
        const g = business.data!.progress?.goals.find(
          (g) => g.horizon === horizon && goalPeriodState(g) === "current",
        );
        return [horizon, g ? { id: g.id, title: g.title } : { title: "" }];
      }),
    ) as typeof goals;
    setGoals(current);
    initialGoals.current = current;
    draftBase.current = personal.profile.updatedAt;
    try {
      const raw = window.sessionStorage.getItem(setupDraftKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const validGoals = (value: Record<string, { title?: unknown; id?: unknown }> | null) =>
        value &&
        ["quarter", "month", "week"].every(
          (h) =>
            typeof value[h]?.title === "string" &&
            (value[h].id === undefined || typeof value[h].id === "string"),
        );
      const valid =
        setupDraftStep(saved.version, saved.step) !== undefined &&
        saved.draft &&
        ["name", "role", "about", "responsePreferences", "timeZone", "currency", "avatar"].every(
          (key) => typeof saved.draft[key] === "string",
        ) &&
        (saved.draft.hourlyRate === undefined ||
          saved.draft.hourlyRate === null ||
          (typeof saved.draft.hourlyRate === "number" &&
            Number.isFinite(saved.draft.hourlyRate) &&
            saved.draft.hourlyRate >= 0 &&
            saved.draft.hourlyRate <= 1_000_000)) &&
        saved.businessDraft &&
        typeof saved.businessDraft === "object" &&
        !Array.isArray(saved.businessDraft) &&
        Object.values(saved.businessDraft).every((value) => typeof value === "string") &&
        (saved.version < 3 ||
          (saved.businessBase &&
            typeof saved.businessBase === "object" &&
            !Array.isArray(saved.businessBase) &&
            Object.values(saved.businessBase).every((value) => typeof value === "string"))) &&
        validGoals(saved.goals) &&
        validGoals(saved.initialGoals);
      if (!valid) {
        window.sessionStorage.removeItem(setupDraftKey);
        return;
      }
      if (saved.baseUpdatedAt !== personal.profile.updatedAt) {
        setError(
          "Your saved profile changed in another tab. The latest profile is shown; review your details before continuing.",
        );
        return;
      }
      const publicProfiles =
        saved.draft.publicProfiles === undefined
          ? personal.profile.publicProfiles
          : saved.version === 4
            ? editableProfileLinks(saved.draft.publicProfiles)
            : parsePublicProfiles(saved.draft.publicProfiles);
      setDraft({ ...personal.profile, ...saved.draft, publicProfiles, onboardingFlowVersion: 2 });
      if (saved.version >= 3) {
        setBusinessDraft({
          ...business.data!.profile,
          ...profileChanges<BusinessProfile>(saved.businessBase, saved.businessDraft),
        });
      } else if (
        Object.keys(profileChanges<BusinessProfile>(business.data!.profile, saved.businessDraft))
          .length
      ) {
        setError(
          "Your personal draft was restored. Review your business details before continuing; the latest saved business profile is shown.",
        );
      }
      setGoals(saved.goals);
      initialGoals.current = saved.initialGoals;
      setStep(setupDraftStep(saved.version, saved.step)!);
      setDirty(true);
      backupSaved.current = true;
    } catch {
      /* A saved profile remains usable when session storage is unavailable. */
    }
  }, [loaded, personal.profile, business.data]);
  useEffect(() => {
    if (!initialized.current || !dirty) return;
    try {
      window.sessionStorage.setItem(
        setupDraftKey,
        JSON.stringify({
          version: 4,
          baseUpdatedAt: draftBase.current,
          draft,
          businessDraft,
          businessBase: businessBase.current,
          goals,
          initialGoals: initialGoals.current,
          step,
        }),
      );
      backupSaved.current = true;
    } catch {
      backupSaved.current = false;
      setError(
        "This browser can’t keep an unsaved draft. Use Save & exit before leaving this page.",
      );
    }
  }, [dirty, draft, businessDraft, goals, step]);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirty && !backupSaved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  const change = (patch: Partial<WorkspaceProfile>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const changeBusiness = (patch: Partial<BusinessProfile>) => {
    setBusinessDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  async function persist(nextStep = step, complete = false, leave = false) {
    if (busy || !loaded) return;
    setBusy(true);
    setError("");
    try {
      const publicProfiles = parsePublicProfiles(draft.publicProfiles || []);
      const changes = (["quarter", "month", "week"] as const)
        .filter((h) => goals[h].title !== initialGoals.current[h].title)
        .map((horizon) => ({ ...goals[horizon], horizon }));
      if (changes.some((g) => !g.title.trim()))
        throw new Error(
          "Keep a title for an existing goal. You can manage earlier goals in Progress.",
        );
      try {
        new Intl.DateTimeFormat("en", { timeZone: draft.timeZone }).format();
      } catch {
        throw new Error("Choose a valid timezone before continuing.");
      }
      if (
        draft.hourlyRate !== null &&
        (!Number.isFinite(draft.hourlyRate) || draft.hourlyRate < 0 || draft.hourlyRate > 1_000_000)
      )
        throw new Error("Choose an hourly value between 0 and 1,000,000, or leave it blank.");
      if (dirty) {
        const businessPatch = profileChanges(businessBase.current, businessDraft);
        if (draft.name !== personalBase.current.name) businessPatch.preferredName = draft.name;
        if (Object.keys(businessPatch).length) {
          const savedBusiness = await business.saveProfile(businessPatch);
          businessBase.current = savedBusiness.profile;
          setBusinessDraft(savedBusiness.profile);
        }
        if (changes.length) {
          const savedBusiness = await business.saveProgress({
            action: "setup-goals",
            goals: changes,
            timeZone: draft.timeZone,
          });
          const savedGoals = Object.fromEntries(
            (["quarter", "month", "week"] as const).map((horizon) => {
              const goal = savedBusiness.progress?.goals.find(
                (g) => g.horizon === horizon && goalPeriodState(g) === "current",
              );
              return [horizon, goal ? { id: goal.id, title: goal.title } : goals[horizon]];
            }),
          ) as typeof goals;
          setGoals(savedGoals);
          initialGoals.current = savedGoals;
        }
      }
      const savedProfile = await personal.save({
        ...profileChanges(personalBase.current, { ...draft, publicProfiles, city: draft.city?.trim() || cityFromZone(draft.timeZone) }),
        onboardingStep: setupStoredStep(nextStep),
        complete,
      });
      personalBase.current = savedProfile;
      draftBase.current = savedProfile.updatedAt;
      setDraft(savedProfile);
      setCurrency(savedProfile.currency);
      setDirty(false);
      try {
        window.sessionStorage.removeItem(setupDraftKey);
      } catch {
        /* The durable save is already confirmed. */
      }
      backupSaved.current = false;
      void operator.refresh();
      if (complete || leave) {
        await navigate({ to: "/business" });
        if (complete) void celebrateSetup().catch(() => {});
      } else setStep(nextStep);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const story = steps[step] || steps[0];
  return (
    <div className="ws-onboarding ws-calm ws-framed" data-setup-step={step}>
      <header className="ws-calm-top">
        <Link
          className="ws-calm-brand"
          to="/business"
          onClick={(event) => {
            if (busy || dirty) {
              event.preventDefault();
              if (!busy) void persist(step, false, true);
            }
          }}
        >
          <ProviderOrbit className="ws-brand-orbit" />
          <strong>Agentic OS</strong>
        </Link>
        <div className="ws-calm-top-actions">
          <a className="ws-setup-guide" href="/community-guide.html" target="_blank" rel="noreferrer" aria-label="Setup guide">Guide</a>
          <ThemeToggle />
          <button
            type="button"
            className="ws-calm-preferences"
            onClick={() => openPanel("profile")}
          >
            Preferences
          </button>
          <button
            type="button"
            className="ws-calm-exit"
            disabled={busy}
            onClick={() =>
              loaded ? void persist(step, false, true) : void navigate({ to: "/business" })
            }
          >
            {loaded ? "Save & exit" : "Exit"}
            <X size={14} />
          </button>
        </div>
      </header>
      <main className="ws-calm-shell">
        <div className="ws-calm-art">
          <SetupLandscape src="/onboarding/welcome-loop-v4.mp4" poster="/onboarding/welcome-loop-v4-poster.jpg" />
        </div>
        <nav className="ws-calm-tabs" aria-label="Setup sections">
          {steps.map((item, index) => (
            <button
              type="button"
              key={item.title}
              aria-current={step === index ? "step" : undefined}
              disabled={busy || !!connectionBusy || !loaded}
              onClick={() => void persist(index)}
            >
              {item.title}
            </button>
          ))}
        </nav>
        <section className="ws-calm-body" aria-busy={busy} aria-labelledby="setup-question">
          <header className="ws-calm-question">
            <h1 id="setup-question" ref={heading} tabIndex={-1}>
              {story.heading}
            </h1>
            {story.copy && <p>{story.copy}</p>}

          </header>
          {!loaded ? (
            personal.error || business.error ? (
              <div className="ws-load-error" role="alert">
                <p>Your saved setup couldn’t load.</p>
                <button
                  type="button"
                  className="ws-text-button"
                  onClick={() => void Promise.allSettled([personal.refresh(), business.refresh()])}
                >
                  Try again
                </button>
              </div>
            ) : (
              <p role="status" className="ws-muted">
                Opening your workspace…
              </p>
            )
          ) : (
            <div className="ws-calm-fields">
              {step === 0 && (
                <>
                  <div className="ws-calm-name-row">
                    <SetupPhoto value={draft} onChange={change} disabled={busy} />
                    <label className="ws-calm-field">
                      <span>Your name</span>
                      <input
                        autoComplete="given-name"
                        placeholder="What should we call you?"
                        maxLength={160}
                        value={draft.name}
                        disabled={busy}
                        onChange={(event) => change({ name: event.target.value })}
                      />
                    </label>
                    <label className="ws-calm-field ws-calm-city">
                      <span>Your city</span>
                      <input
                        autoComplete="address-level2"
                        placeholder={cityFromZone(draft.timeZone) || "Where you are based"}
                        maxLength={80}
                        value={draft.city || ""}
                        disabled={busy}
                        onChange={(event) => change({ city: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="ws-about-pair">
                    <label className="ws-calm-field">
                      <span>
                        About you{" "}
                        <a href={profileResources.life} target="_blank" rel="noreferrer">
                          Life profile <ArrowUpRight size={11} />
                        </a>
                      </span>
                      <textarea
                        rows={3}
                        maxLength={6000}
                        value={personalContext(draft)}
                        disabled={busy}
                        placeholder="Your interests, priorities and how you like to work…"
                        onChange={(event) => change(personalContextPatch(event.target.value))}
                      />
                    </label>
                    <label className="ws-calm-field">
                      <span>
                        About your business{" "}
                        <a href={profileResources.business} target="_blank" rel="noreferrer">
                          Business profile <ArrowUpRight size={11} />
                        </a>
                      </span>
                      <textarea
                        rows={3}
                        maxLength={3000}
                        value={businessDraft.whatYouDo || ""}
                        disabled={busy}
                        placeholder="What you do, who you help and what you're building…"
                        onChange={(event) => changeBusiness({ whatYouDo: event.target.value })}
                      />
                    </label>
                  </div>
                </>
              )}
              <div hidden={step !== 1}>
                <SetupScanConnections
                  stage={connectionStage}
                  onStageChange={setConnectionStage}
                  onBusyChange={setConnectionBusy}
                  onScanned={setConnectionsScanned}
                  onAgentChecks={() => openPanel("agents")}
                  socialProfiles={<SetupSocialLinks value={draft} onChange={change} disabled={busy} compact />}
                  tools={draft.tools || []}
                  onToolsChange={(tools) => change({ tools })}
                  importRef={importSelected}
                  onPendingChange={setPendingImports}
                  onImported={setImported}
                />
              </div>
              {step === 2 && imported.length > 0 && (
                <div className="ws-calm-imported" aria-label="What your OS now knows">
                  <span>Your OS now knows</span>
                  {imported.map((item) => <em key={item}>{item}</em>)}
                </div>
              )}
              {step === 2 && (
                <div className="ws-calm-goals">
                  {(
                    [
                      { id: "week", label: "This week", placeholder: "One thing to finish" },
                      { id: "month", label: "This month", placeholder: "Your next milestone" },
                      { id: "quarter", label: "This quarter", placeholder: "The bigger ambition" },
                    ] as const
                  ).map((goal) => (
                    <label key={goal.id} data-horizon={goal.id}>
                      <img className="ws-goal-art" src={`/onboarding/goal-${goal.id}.jpg`} alt="" />
                      <span>{goal.label}</span>
                      <input
                        value={goals[goal.id].title}
                        maxLength={300}
                        disabled={busy}
                        placeholder={goal.placeholder}
                        onChange={(event) => {
                          setGoals((current) => ({
                            ...current,
                            [goal.id]: { ...current[goal.id], title: event.target.value },
                          }));
                          setDirty(true);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <footer className="ws-calm-footer">
          <button
            type="button"
            className="ws-calm-back"
            disabled={busy || !!connectionBusy || !loaded}
            onClick={() => step === 1 && connectionsScanned && connectionStage > 0 ? setConnectionStage(connectionStage - 1) : (step ? void persist(step - 1) : void persist(step, false, true))}
          >
            {step ? (
              <>
                <ArrowLeft size={14} />
                Back
              </>
            ) : (
              "Skip for now"
            )}
          </button>
          <FlowButton
            className="ws-flow-next"
            disabled={busy || !!connectionBusy || !loaded}
            onClick={async () => {
              // On the connections step, Continue first imports what is switched on, then moves on.
              if (step === 1 && connectionsScanned) {
                if (connectionStage < 3) { setConnectionStage(connectionStage + 1); return; }
                const ok = await (importSelected.current?.() ?? Promise.resolve(true));
                if (!ok) return;
              }
              void persist(Math.min(step + 1, steps.length - 1), step === steps.length - 1);
            }}
          >
            {busy ? "Saving…" : connectionBusy && step === 1 ? connectionBusy === "scan" ? "Scanning…" : "Importing…" : step === steps.length - 1 ? "Build my OS" : step === 1 && connectionsScanned ? (connectionStage < 3 ? `Next: ${connectionStages[connectionStage + 1].name}` : pendingImports ? `Import ${pendingImports} & continue` : "Continue") : "Continue"}
          </FlowButton>
        </footer>
      </main>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent
          className="ws-onboarding ws-calm-modal"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            panelOrigin.current?.focus();
          }}
        >
          <DialogTitle>
            {
              {
                profile: "Make it yours",
                apps: "Connect your apps",
                agents: "Connect your agents",
                memory: "Make photos searchable",
              }[panel || "profile"]
            }
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose the details and connections your OS can use.
          </DialogDescription>
          {panel === "profile" && (
            <>
              <PersonalProfileFields value={draft} onChange={change} disabled={busy} />
              <label className="ws-calm-field">
                <span>Your business or project</span>
                <textarea
                  rows={3}
                  maxLength={3000}
                  value={businessDraft.whatYouDo || ""}
                  disabled={busy}
                  placeholder="What do you do, and who do you help?"
                  onChange={(event) => changeBusiness({ whatYouDo: event.target.value })}
                />
              </label>
              <details className="ws-details">
                <summary>
                  Profile links
                  <ChevronDown size={14} />
                </summary>
                <SetupSocialLinks value={draft} onChange={change} disabled={busy} />
              </details>
              <div className="ws-profile-resources">
                <a href={profileResources.life} target="_blank" rel="noreferrer">
                  Life profile template
                  <ArrowUpRight size={12} />
                </a>
                <a href={profileResources.business} target="_blank" rel="noreferrer">
                  Business profile template
                  <ArrowUpRight size={12} />
                </a>
              </div>
            </>
          )}
          {panel === "apps" && <SetupConnections />}
          {panel === "agents" && (
            <>
              <SetupAgentConnections />
              <details className="ws-details">
                <summary>
                  Other AI tools
                  <ChevronDown size={14} />
                </summary>
                <ToolDiscovery compact />
              </details>
            </>
          )}
          {panel === "memory" && (
            <>
              <PhotoIndexSetup compact />
            </>
          )}
          <button type="button" className="ws-calm-modal-done" onClick={() => setPanel(null)}>
            Done
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
