// What is actually on this computer: whether OpenClaw is installed, its version and
// whether its gateway answers, and the limits it works within when Jarvis hands it
// something. Agreeing to those limits is this page's button, and only this page's.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { operatorRequest } from "@/lib/operator";

type Status = {
  installed: boolean;
  version?: string;
  model?: string;
  gateway?: "running" | "stopped" | "unknown";
  localOnly?: boolean;
  address?: string;
};
type Limits = {
  folder: string;
  model?: string;
  minutes: number;
  tasksPerDay: number;
  dollarsPerDay: number;
  agreedAt?: string;
};
type Reply = {
  openclaw: Status;
  limits: Limits | null;
  suggested: Limits | null;
  settings: unknown;
};

const TONE = "#EF4444";
/** A model as a person reads it: without the sign-in OpenClaw notes after the @. */
const plain = (model: string) => model.split("@")[0];
const GATEWAY: Record<NonNullable<Status["gateway"]>, string> = {
  running: "Running",
  stopped: "Not running",
  unknown: "Could not be checked",
};

function Fact({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-medium">
        {on !== undefined && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: on ? "#34d399" : "#71717a",
              boxShadow: on ? "0 0 10px #34d39988" : undefined,
            }}
          />
        )}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  wide?: boolean;
}) {
  return (
    <label className={`min-w-0 ${wide ? "sm:col-span-3" : ""}`}>
      <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
        value={value}
        type={wide ? "text" : "number"}
        step={step}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** The whole settings file a hand-off runs under, for the person to read before agreeing. */
function Settings({ settings }: { settings: unknown }) {
  if (!settings) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">See the exact settings each task runs under</summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 text-[11px] leading-relaxed">
        {JSON.stringify(settings, null, 2)}
      </pre>
    </details>
  );
}

/** The limits, to agree to or as agreed. */
function LimitsPanel({
  limits,
  suggested,
  model,
  settings,
}: {
  limits: Limits | null;
  suggested: Limits | null;
  model?: string;
  settings: unknown;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<keyof Limits, string> | null>(null);
  useEffect(() => {
    if (suggested && !draft)
      setDraft({
        folder: suggested.folder,
        model: "",
        minutes: String(suggested.minutes),
        tasksPerDay: String(suggested.tasksPerDay),
        dollarsPerDay: String(suggested.dollarsPerDay),
        agreedAt: "",
      });
  }, [suggested, draft]);
  const change = useMutation({
    mutationFn: (body: unknown) => operatorRequest("/ceo/openclaw/limits", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operator-ceo-openclaw"] }),
  });
  const error = change.error ? (
    <p className="mt-3 text-xs text-red-400">{(change.error as Error).message}</p>
  ) : null;

  if (limits)
    return (
      <div className="mt-5 border-t border-border pt-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Fact label="Works in" value={limits.folder} />
          <Fact label="Time limit" value={`${limits.minutes} min a task`} />
          <Fact label="Each day" value={`${limits.tasksPerDay} tasks`} />
          <Fact label="Spend a day" value={`$${limits.dollarsPerDay}`} />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Each task gets its own folder in there and can read, write and edit files in it, with{" "}
          {limits.model ? plain(limits.model) : "the agreed model"}. No commands, no browser, no
          web, no messaging, and none of the accounts connected to OpenClaw.
          {model && limits.model && model !== limits.model
            ? ` OpenClaw itself now uses ${plain(model)}; withdraw and agree again to hand work to that one.`
            : ""}
        </p>
        <Settings settings={settings} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Agreed {limits.agreedAt ? new Date(limits.agreedAt).toLocaleString() : ""}. One task at
            a time.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
            disabled={change.isPending}
            onClick={() => change.mutate({ withdraw: true })}
          >
            Withdraw: stop handing it work
          </button>
        </div>
        {error}
      </div>
    );
  if (!draft) return null;
  const set = (key: keyof Limits) => (value: string) => setDraft({ ...draft, [key]: value });
  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-3 text-xs text-muted-foreground">
        Jarvis hands OpenClaw nothing until you agree to these. Each task runs once, in its own
        folder inside the one below, under settings the OS writes for that run: it can read, write
        and edit files in that folder and nothing else. No commands, no browser, no web, no
        messaging, and none of the accounts connected to OpenClaw. Your own OpenClaw settings are
        not changed. OpenClaw's own runtime does the work, so its model needs a sign-in that runtime
        can use, such as an API key; with one that works only through Codex, a task fails before
        anything runs.{" "}
        {model
          ? `It works with ${plain(model)}, the model OpenClaw uses now.`
          : "The OS could not read which model OpenClaw uses, so there is nothing to agree to yet."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Work folder" value={draft.folder} onChange={set("folder")} wide />
        <Field label="Minutes a task" value={draft.minutes} onChange={set("minutes")} />
        <Field label="Tasks a day" value={draft.tasksPerDay} onChange={set("tasksPerDay")} />
        <Field
          label="Dollars a day"
          value={draft.dollarsPerDay}
          onChange={set("dollarsPerDay")}
          step="0.5"
        />
      </div>
      <button
        className="mt-4 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style={{ background: TONE }}
        disabled={change.isPending || !model}
        onClick={() =>
          change.mutate({
            agree: true,
            folder: draft.folder.trim(),
            model,
            minutes: Number(draft.minutes),
            tasksPerDay: Number(draft.tasksPerDay),
            dollarsPerDay: Number(draft.dollarsPerDay),
          })
        }
      >
        Agree: let Jarvis hand OpenClaw work within these limits
      </button>
      <Settings settings={settings} />
      {error}
    </div>
  );
}

export function OpenClawLive() {
  const live = useQuery({
    queryKey: ["operator-ceo-openclaw"],
    queryFn: () => operatorRequest<Reply>("/ceo/openclaw"),
    refetchInterval: 30_000,
    retry: false,
  });
  const status = live.data?.openclaw;
  return (
    <section
      className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card p-5"
      style={{ backgroundImage: `radial-gradient(120% 80% at 0% 0%, ${TONE}14, transparent 60%)` }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-red-300/80">Live</div>
          <h2 className="text-sm font-semibold">OpenClaw on this computer</h2>
        </div>
        {status?.gateway === "running" && status.address && (
          <a
            href={status.address}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: `${TONE}55`, color: TONE }}
          >
            Open OpenClaw <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {!status ? (
        <p className="text-xs text-muted-foreground">
          {live.isError ? "The OS could not check OpenClaw just now." : "Checking…"}
        </p>
      ) : !status.installed ? (
        <p className="text-xs text-muted-foreground">OpenClaw is not installed on this computer.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Fact
              label="Installed"
              value={status.version ? `Version ${status.version}` : "Yes"}
              on
            />
            <Fact
              label="Gateway"
              value={
                GATEWAY[status.gateway ?? "unknown"] +
                (status.gateway === "running" && status.localOnly ? ", this computer only" : "")
              }
              on={status.gateway === "running"}
            />
            <Fact
              label="Work from Jarvis"
              value={
                live.data?.limits ? "On, within your limits" : "Off until you agree to its limits"
              }
              on={!!live.data?.limits}
            />
          </div>
          <LimitsPanel
            limits={live.data?.limits ?? null}
            suggested={live.data?.suggested ?? null}
            model={status.model}
            settings={live.data?.settings ?? null}
          />
        </>
      )}
    </section>
  );
}
