import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import higgsfieldLogo from "@/assets/logos/higgsfield.png";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const HIGGSFIELD_ACCOUNT_EVENT = "higgsfield-account-updated";

/** A separate, app-owned Higgsfield sign-in. No grants are borrowed from another app. */
export function HiggsfieldAccountConnection({ compact = false }: { compact?: boolean }) {
  const [connected, setConnected] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const until = useRef(0);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch("/__design_higgsfield_account/status");
        const data = await response.json();
        if (!live || !response.ok || !data.ok) return;
        setConnected(Boolean(data.connected));
        if (waiting && data.connected) {
          setWaiting(false);
          setAuthorizationUrl(null);
          window.dispatchEvent(new Event(HIGGSFIELD_ACCOUNT_EVENT));
        } else if (waiting && Date.now() > until.current) {
          setWaiting(false);
          setError("Sign-in has timed out. Connect again to start a fresh sign-in.");
        }
      } catch {
        // Keep the current state when a local development server restarts.
      }
    };
    void refresh();
    const timer = waiting ? window.setInterval(refresh, 3_000) : null;
    window.addEventListener(HIGGSFIELD_ACCOUNT_EVENT, refresh);
    return () => {
      live = false;
      if (timer) window.clearInterval(timer);
      window.removeEventListener(HIGGSFIELD_ACCOUNT_EVENT, refresh);
    };
  }, [waiting]);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Open synchronously so a user's click can open the provider's sign-in.
    const popup = window.open("about:blank", "_blank", "width=580,height=740");
    if (popup) popup.opener = null;
    try {
      const { token } = await (await fetch("/__token")).json();
      const response = await fetch("/__design_higgsfield_account/connect", {
        method: "POST",
        headers: { "X-Claude-OS-Token": token },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not start Higgsfield sign-in");
      const url = new URL(data.authorizationUrl);
      if (url.origin !== "https://clerk.higgsfield.ai") throw new Error("Unexpected Higgsfield sign-in address");
      if (popup) popup.location.href = url.href;
      setAuthorizationUrl(url.href);
      until.current = data.expiresAt;
      setWaiting(true);
    } catch (failure) {
      popup?.close();
      setError(failure instanceof Error ? failure.message : "Could not start Higgsfield sign-in");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await (await fetch("/__token")).json();
      const response = await fetch("/__design_higgsfield_account/disconnect", {
        method: "POST",
        headers: { "X-Claude-OS-Token": token },
      });
      if (!response.ok) throw new Error("Could not disconnect Higgsfield");
      setConnected(false);
      setWaiting(false);
      setAuthorizationUrl(null);
      window.dispatchEvent(new Event(HIGGSFIELD_ACCOUNT_EVENT));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not disconnect Higgsfield");
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    const actionClass = "inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[#eee9ff] px-4 py-2.5 text-[12px] font-semibold text-[#191423] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200 disabled:opacity-60";
    return (
      <Popover open={Boolean(error)} onOpenChange={(open) => { if (!open) setError(null); }}>
        <PopoverTrigger asChild>
          {waiting && authorizationUrl ? (
            <a href={authorizationUrl} target="_blank" rel="noreferrer" className={actionClass} aria-label="Finish Higgsfield sign-in">
              <ArrowUpRight className="h-3.5 w-3.5" /> Finish sign-in
            </a>
          ) : (
            <button type="button" onClick={() => void connect()} disabled={busy || connected} className={actionClass}
              title="Connect your Higgsfield account to use Nano Banana 2 with your credits">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : connected ? <Check className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              {busy ? "Opening…" : connected ? "Connected" : "Connect Higgsfield"}
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={10} collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-[100] w-72 max-w-[calc(100vw-24px)] rounded-xl border-rose-300/20 bg-[#171d28] p-3 text-[12px] text-rose-100"
          role="alert">
          {error}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="my-3 rounded-xl border border-violet-300/20 bg-violet-300/[0.045] p-3">
      <div className="flex items-center gap-3">
        <img src={higgsfieldLogo} alt="Higgsfield" className="h-7 w-7 rounded-lg object-contain" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-white/90">Higgsfield account</div>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-white/50">
            Nano Banana 2 · your Higgsfield credits
          </p>
        </div>
        {connected ? (
          <button onClick={() => void disconnect()} disabled={busy} title="Disconnect this OS from Higgsfield" className="flex items-center gap-1.5 rounded-lg border border-emerald-300/20 px-2.5 py-2 text-[10.5px] text-emerald-200">
            <Check className="h-3.5 w-3.5" /> Disconnect
          </button>
        ) : (
          <button onClick={() => void connect()} disabled={busy || waiting} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#eee9ff] px-3 py-2 text-[11px] font-medium text-[#191423] disabled:opacity-60">
            {busy || waiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
            {waiting ? "Finish sign-in" : busy ? "Opening…" : "Connect Higgsfield"}
          </button>
        )}
      </div>
      {!connected && <p className="mt-2 text-[10px] leading-relaxed text-white/40">Sign in once with Higgsfield to use Nano Banana 2 here. API usage is billed separately.</p>}
      {waiting && authorizationUrl && <a className="mt-2 inline-flex text-[11px] text-violet-200 underline underline-offset-4" href={authorizationUrl} target="_blank" rel="noreferrer">Open Higgsfield sign-in</a>}
      {error && <p role="alert" className="mt-2 text-[11px] text-rose-200">{error}</p>}
    </div>
  );
}
