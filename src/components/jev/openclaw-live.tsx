// What is actually on this computer: whether OpenClaw is installed, its version and
// whether its gateway answers. Read from the OS, which only reads from OpenClaw.
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { operatorRequest } from "@/lib/operator";

type Status = { installed: boolean; version?: string; gateway?: "running" | "stopped" | "unknown"; address?: string };

const TONE = "#EF4444";
const GATEWAY: Record<NonNullable<Status["gateway"]>, string> = { running: "Running", stopped: "Not running", unknown: "Not checked yet" };

function Fact({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-medium">
        {on !== undefined && (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: on ? "#34d399" : "#71717a", boxShadow: on ? "0 0 10px #34d39988" : undefined }} />
        )}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

export function OpenClawLive() {
  const live = useQuery({
    queryKey: ["operator-ceo-openclaw"],
    queryFn: () => operatorRequest<{ openclaw: Status }>("/ceo/openclaw"),
    refetchInterval: 15_000,
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
        <p className="text-xs text-muted-foreground">{live.isError ? "The OS could not check OpenClaw just now." : "Checking…"}</p>
      ) : !status.installed ? (
        <p className="text-xs text-muted-foreground">OpenClaw is not installed on this computer.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Fact label="Installed" value={status.version ? `Version ${status.version}` : "Yes"} on />
          <Fact label="Gateway" value={GATEWAY[status.gateway ?? "unknown"]} on={status.gateway === "running"} />
          <Fact label="Work from Jarvis" value="Off until you set its limits" on={false} />
        </div>
      )}
    </section>
  );
}
