import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  operatorRequest,
  type ConnectionDiscovery,
  type ExistingAppConnection,
} from "@/lib/operator";

export function SetupConnectionsSummary() {
  const [ready, setReady] = useState(false);
  const [, setClock] = useState(0);
  useEffect(() => setReady(true), []);
  const discovery = useQuery<ConnectionDiscovery>({
    queryKey: ["setup-connections"],
    enabled: ready,
    queryFn: () => operatorRequest("/setup/connections"),
    staleTime: 30000,
    retry: false,
  });
  const data = discovery.data;
  useEffect(() => {
    const remaining = Date.parse(data?.expiresAt || "") - Date.now();
    if (!Number.isFinite(remaining) || remaining < 0) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(remaining + 10, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [data?.expiresAt]);
  const fresh =
    data?.status === "available" && data.runtimeFresh && Date.parse(data.expiresAt) > Date.now();
  const available = (app: ExistingAppConnection) =>
    fresh &&
    app.callable === true &&
    app.isEnabled !== false &&
    app.runtimeEnabled !== false &&
    app.isAccessible !== false;
  const apps = (data?.apps || []).filter(app => app.harness !== "claude" && (app.observed || app.isAccessible === true)).sort((a, b) => Number(available(b)) - Number(available(a)));
  const count = apps.filter(available).length;
  return (
    <details className="ws-details ws-codex-connections">
      <summary>
        Apps through Codex{" "}
        <span>
          {discovery.isPending || discovery.isFetching
            ? "Checking…"
            : count
              ? `${count} available`
              : "Optional"}
        </span>
        <ChevronDown size={14} />
      </summary>
      <p className="ws-muted">
        These apps belong to Codex. Direct inbox or calendar sync needs its own connection. Other
        chat models do not inherit this access.
      </p>
      {!!apps.length && (
        <ul>
          {apps.slice(0, 6).map((app) => (
            <li key={app.id}>
              <strong>{app.name}</strong>
              <span>
                {app.isEnabled === false || app.runtimeEnabled === false
                  ? "Disabled in Codex"
                  : app.isAccessible === false
                    ? "Access unavailable"
                    : available(app)
                      ? "Available through Codex"
                      : !fresh
                        ? "Availability needs a fresh check"
                        : app.callable === false
                          ? "Not callable in this session"
                          : "Availability not checked"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!apps.length && !discovery.isPending && !discovery.isFetching && (
        <p className="ws-muted">
          {discovery.isError || !fresh
            ? "Codex app availability couldn’t be checked. You can continue setup."
            : "No Codex apps were found. Connect only what you use, whenever you need it."}
        </p>
      )}
      {!!data?.detail && data.status !== "available" && <p className="ws-muted">{data.detail}</p>}
      {(apps.length > 6 || data?.truncated) && (
        <p className="ws-muted">Showing a few apps. Choose the connections you want to use below.</p>
      )}
      <button
        type="button"
        className="ws-text-button"
        onClick={() => window.dispatchEvent(new CustomEvent("agentic:accounts", { detail: { group: "work" } }))}
      >
        Choose existing connections
      </button>
      <button
        type="button"
        className="ws-text-button"
        disabled={discovery.isFetching}
        onClick={() => void discovery.refetch()}
      >
        {discovery.isFetching ? "Checking…" : "Check again"}
      </button>
    </details>
  );
}
