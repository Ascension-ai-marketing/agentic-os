import { useState } from "react";
import { ArrowUpRight, Mail, Check, Image as ImageIcon } from "lucide-react";
import { ProviderLogo } from "./account-connections";
import type { RecentVoiceResult } from "@/lib/voice-recent";
import "./voice-recent-results.css";

const when = (date: string) => {
  const value = new Date(date);
  return Number.isFinite(value.getTime())
    ? value.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time unavailable";
};
function emailLink(value?: string) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "mail.google.com",
        "outlook.office.com",
        "outlook.office365.com",
        "outlook.live.com",
      ].includes(url.hostname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function VoiceRecentResults({
  result,
  onOpenDesign,
  onOpenInbox,
}: {
  result: RecentVoiceResult;
  onOpenDesign: () => void;
  onOpenInbox: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  if (result.kind === "creations") {
    const item = result.items[Math.min(selected, result.items.length - 1)];
    return (
      <section className="jarvis-recent" aria-label="Recent creations">
        <div className="jarvis-recent-heading">
          <span>From your Design studio</span>
          <button onClick={onOpenDesign}>
            Open Design <ArrowUpRight size={14} />
          </button>
        </div>
        {item ? (
          <>
            <div className="jarvis-creation-image">
              {failedImages.includes(item.id) ? (
                <span>
                  <ImageIcon size={26} />
                  Preview no longer available
                </span>
              ) : (
                <img
                  src={item.previewUrl}
                  alt={item.title}
                  onError={() => setFailedImages((old) => [...old, item.id])}
                />
              )}
              <span className="jarvis-creation-label">
                {selected === 0 ? "Latest creation" : "Recent creation"}
              </span>
            </div>
            <h2>{item.title}</h2>
            <p className="jarvis-creation-receipt">
              Created {when(item.createdAt)}
              {item.model ? ` · ${item.model}` : ""}
            </p>
            {result.items.length > 1 && (
              <div className="jarvis-creation-strip" aria-label="Other recent creations">
                {result.items.slice(0, 6).map((entry, index) => (
                  <button
                    key={entry.id}
                    aria-label={`Show creation ${index + 1}: ${entry.title}`}
                    aria-pressed={index === selected}
                    onClick={() => setSelected(index)}
                  >
                    <img src={entry.previewUrl} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="jarvis-recent-empty">
            <ImageIcon size={25} />
            <p>No completed images recorded in Design yet.</p>
          </div>
        )}
        <p className="jarvis-recent-note">Creation history · checked {when(result.checkedAt)}</p>
      </section>
    );
  }
  return (
    <section className="jarvis-recent" aria-label="Recent email results">
      <div className="jarvis-recent-heading">
        <span>
          {result.mode === "live"
            ? "Mail checked just now"
            : result.mode === "mixed"
              ? "Mail · some accounts unavailable"
              : "Saved mail · live check unavailable"}
        </span>
        <button onClick={onOpenInbox}>
          Open Inbox <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="jarvis-mail-providers">
        {result.providers
          .filter((p) => p.status !== "not-connected")
          .map((provider) => (
            <span key={provider.provider} data-live={provider.status === "live"}>
              <span />
              {provider.provider === "gmail" ? "Gmail" : "Outlook"} ·{" "}
              {provider.status === "live" ? "Checked" : "Unavailable"}
            </span>
          ))}
      </div>
      <div className="jarvis-recent-mail-list">
        {result.items.slice(0, 5).map((item) => {
          const href = emailLink(item.url);
          return (
            <details className="jarvis-recent-mail" key={item.id}>
              <summary>
                <span className="jarvis-mail-icon">
                  <ProviderLogo provider={item.source === "gmail" ? "google" : "outlook"} />
                </span>
                <span>
                  <strong>{item.subject || "No subject"}</strong>
                  <small>{item.from}</small>
                </span>
                <time dateTime={item.receivedAt}>{when(item.receivedAt)}</time>
              </summary>
              <div className="jarvis-recent-mail-meta">
                <span>
                  {item.source === "gmail" ? "Gmail" : "Outlook"} ·{" "}
                  {item.evidence === "live" ? "Live lookup" : "Saved copy"}
                </span>
                <time dateTime={item.receivedAt}>{when(item.receivedAt)}</time>
              </div>
              {item.body && <p className="jarvis-recent-excerpt">{item.body}</p>}
              {href && (
                <a href={href} target="_blank" rel="noreferrer">
                  Open email <ArrowUpRight size={13} />
                </a>
              )}
            </details>
          );
        })}
      </div>
      {!result.items.length && (
        <div className="jarvis-recent-empty">
          <Mail size={25} />
          <p>
            {result.mode === "live"
              ? "No recent messages returned by the checked accounts."
              : "I couldn’t verify your latest mail. Check the connection in Inbox."}
          </p>
        </div>
      )}
      <p className="jarvis-recent-note">
        {result.mode === "live" && <Check size={12} />}
        {result.freshness}
      </p>
    </section>
  );
}
