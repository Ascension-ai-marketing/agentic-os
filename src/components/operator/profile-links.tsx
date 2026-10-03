import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useOperator } from "@/lib/operator";
import {
  parsePublicProfiles,
  profileLinksInMemory,
  PUBLIC_PROFILE_LIMIT,
  type PublicProfileLink,
} from "@/lib/workspace-profile-links";
import "./profile-links.css";

export function ProfileLinks({
  links,
  onChange,
  disabled = false,
  summaryLabel = "Public profile links",
}: {
  links: PublicProfileLink[];
  onChange: (links: PublicProfileLink[]) => void;
  disabled?: boolean;
  summaryLabel?: string;
}) {
  const { state, isLoading, error: loadError } = useOperator();
  const [label, setLabel] = useState(""),
    [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const [suggestions, setSuggestions] = useState<PublicProfileLink[]>();
  const memories = state.sources
    .filter(
      (source) =>
        !source.deletedAt &&
        source.status === "ready" &&
        source.title.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 50);
  function add(link: PublicProfileLink) {
    setError("");
    try {
      onChange(parsePublicProfiles([...links, link]));
      if (!link.source) {
        setLabel("");
        setUrl("");
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <details className="ws-details ws-public-profiles">
      <summary>
        {summaryLabel} <span>{links.length ? `${links.length} added` : "Optional"}</span>
        <ChevronDown size={14} />
      </summary>
      <p className="ws-muted">
        Add only the profiles or websites you want your OS to know. No account connection is made.
      </p>
      {!!links.length && (
        <ul className="ws-profile-link-list">
          {links.map((link, index) => (
            <li key={link.url}>
              <div>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
                <span>{link.url}</span>
                {link.source && <small>From: {link.source.title}</small>}
              </div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${link.label} profile link`}
                onClick={() => onChange(links.filter((_, position) => position !== index))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {links.length < PUBLIC_PROFILE_LIMIT ? (
        <div className="ws-public-profile-entry">
          <label>
            <span>Label</span>
            <input
              value={label}
              maxLength={60}
              placeholder="Website, LinkedIn…"
              disabled={disabled}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            <span>Public URL</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={url}
              maxLength={2048}
              placeholder="https://…"
              disabled={disabled}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="ws-text-button"
            disabled={disabled || !label.trim() || !url.trim()}
            onClick={() => add({ label, url })}
          >
            Add to profile
          </button>
        </div>
      ) : (
        <p className="ws-muted">All {PUBLIC_PROFILE_LIMIT} link spaces are used.</p>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      <details className="ws-profile-link-finder">
        <summary>Find links in a saved memory</summary>
        <p className="ws-muted">
          Choose one memory. Review each link before adding it; it may belong to someone else.
        </p>
        {isLoading ? (
          <p role="status" className="ws-muted">
            Loading saved memories…
          </p>
        ) : loadError ? (
          <p role="alert" className="ws-error">
            Saved memories could not load. You can still add a link above.
          </p>
        ) : !state.sources.some((source) => !source.deletedAt && source.status === "ready") ? (
          <p className="ws-muted">No saved memories yet. You can add links now or return later.</p>
        ) : (
          <>
            <label>
              <span>Find a memory by title</span>
              <input
                type="search"
                value={query}
                disabled={disabled}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                  setSuggestions(undefined);
                }}
                placeholder="Search saved memory titles"
              />
            </label>
            <label>
              <span>Memory to review</span>
              <select
                value={selectedId}
                disabled={disabled}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setSuggestions(undefined);
                }}
              >
                <option value="">Choose one memory</option>
                {memories.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.title}
                  </option>
                ))}
              </select>
            </label>
            {!memories.length && (
              <p className="ws-muted">No matching titles. Try another search.</p>
            )}
            <button
              type="button"
              className="ws-text-button"
              disabled={disabled || !selectedId}
              onClick={() => {
                const source = memories.find((memory) => memory.id === selectedId);
                if (source) setSuggestions(profileLinksInMemory(source));
              }}
            >
              Find explicit profile links
            </button>
            {suggestions && (
              <div
                className="ws-profile-link-suggestions"
                role="region"
                aria-label="Links found in this memory"
              >
                <strong>Links found in this memory</strong>
                <p className="ws-muted">
                  Checked only the available excerpt, up to 8,000 characters. Nothing was looked up
                  online.
                </p>
                {!suggestions.length && (
                  <p className="ws-muted">
                    No supported profile links in this excerpt. You can paste a public link above.
                  </p>
                )}
                {suggestions.map((link) => (
                  <div key={link.url} className="ws-profile-link-suggestion">
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.url}
                    </a>
                    <small>From: {link.source?.title}</small>
                    <button
                      type="button"
                      className="ws-text-button"
                      disabled={
                        disabled ||
                        links.length >= PUBLIC_PROFILE_LIMIT ||
                        links.some((saved) => saved.url === link.url)
                      }
                      onClick={() => add(link)}
                    >
                      {links.some((saved) => saved.url === link.url)
                        ? "Added to profile"
                        : "Use this link"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </details>
    </details>
  );
}
