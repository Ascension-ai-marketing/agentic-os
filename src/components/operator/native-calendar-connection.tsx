import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import calendarLogo from "@/assets/logos/googlecalendar.svg";
import { operatorRequest, useOperator } from "@/lib/operator";
import { Busy } from "./ui";
import "./native-calendar-connection.css";

type NativeCalendar = {
  available: boolean;
  enabled: boolean;
  account?: string;
  error?: string;
  syncing?: boolean;
  coverage?: {
    timeMin: string;
    timeMax: string;
    syncedAt: string;
    eventCount: number;
    complete: boolean;
  };
};
export function useNativeCalendar() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return useQuery<NativeCalendar>({
    queryKey: ["native-calendar"],
    queryFn: () => operatorRequest("/calendar/native"),
    enabled: ready,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
export function NativeCalendarConnection({
  month,
  autoRefresh = false,
}: {
  month?: Date | null;
  autoRefresh?: boolean;
}) {
  const query = useNativeCalendar();
  const { refresh } = useOperator();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    lastAttempt = useRef(0);
  const anchor = month || new Date();
  const timeMin = new Date(anchor.getFullYear(), anchor.getMonth(), -6).toISOString();
  const timeMax = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 8).toISOString();
  const sync = useCallback(
    async (enable = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastAttempt.current = Date.now();
      setBusy(true);
      setError("");
      try {
        await operatorRequest("/calendar/native/sync", { enable, timeMin, timeMax });
        await refresh();
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        await query.refetch();
        inFlight.current = false;
        setBusy(false);
      }
    },
    [timeMin, timeMax, refresh, query.refetch],
  );
  const coverage = query.data?.coverage;
  useEffect(() => {
    if (!autoRefresh || !query.data?.enabled || !query.data.available) return;
    const check = () => {
      if (document.hidden || Date.now() - lastAttempt.current < 60_000) return;
      const covered = coverage && coverage.timeMin <= timeMin && coverage.timeMax >= timeMax;
      if (!covered || Date.now() - Date.parse(coverage.syncedAt) >= 300_000) void sync();
    };
    check();
    const interval = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [autoRefresh, query.data?.enabled, query.data?.available, coverage, timeMin, timeMax, sync]);
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await operatorRequest("/calendar/native/disconnect", {});
      await query.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ar-native-calendar" aria-label="Google Calendar connection">
      <img src={calendarLogo} alt="" />
      <div className="ar-native-calendar-copy">
        <strong>
          {query.data?.enabled ? "Google Calendar connected" : "Your Google Calendar"}
        </strong>
        <p>
          {query.isPending
            ? "Checking your connection…"
            : query.data?.enabled
              ? `${query.data.account} · Read access`
              : query.data?.available
                ? "Use the Google account connected in Settings → Connections."
                : "Connect Google in Settings → Connections and allow calendar access, then check again here."}
        </p>
        {coverage && (
          <small>
            {coverage.eventCount} events ·{" "}
            {new Date(coverage.timeMin).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}{" "}
            to{" "}
            {new Date(coverage.timeMax).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}{" "}
            · Updated{" "}
            {new Date(coverage.syncedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {query.data?.enabled
              ? ". Refreshes every five minutes while Calendar is open."
              : ". Saved snapshot."}
          </small>
        )}
        {(error || query.error || query.data?.error) && (
          <p className="ar-native-calendar-error" role="alert">
            {error || query.error?.message || query.data?.error}
          </p>
        )}
      </div>
      <div className="ar-native-calendar-actions">
        <button
          type="button"
          className="op-button"
          disabled={busy || query.isPending || query.isFetching}
          onClick={() =>
            query.data?.available ? void sync(!query.data.enabled) : void query.refetch()
          }
        >
          {busy ? <Busy /> : <RefreshCw size={13} />}
          {busy
            ? "Refreshing…"
            : query.data?.enabled
              ? "Refresh calendar"
              : query.data?.available
                ? "Use Google Calendar"
                : "Check connection"}
        </button>
        {query.data?.enabled && (
          <button
            type="button"
            className="op-text-link"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Stop syncing
          </button>
        )}
      </div>
    </section>
  );
}
